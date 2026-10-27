import { ORGANIZATION_CATEGORIES, validateOrganization, type OrganizationCategory, type OrganizationProposal } from "../../../src/modules/injury/materials/organization";
import { PrivateError, type PrivateEnv } from "../auth/contracts";
import type { CaseRepository } from "../injury/repository";
import { DriveArchive, seal, unseal, type DriveConnection } from "./drive";
import { assertReceiptCurrent } from "../injury/analysis-receipts";

interface Row {
  id: string; drive_file_id: string; drive_revision: string | null; folder_id: string;
  mime: string; bytes: number; sha256: string; status: string; session_encrypted: string | null;
}
interface MoveJournal {
  version: "cbh-drive-move/v1"; root: string; source: string; target: string;
  category: OrganizationCategory; revision: string | null;
}
const instant=()=>new Date().toISOString();

async function categoryFolder(repo: CaseRepository, api: DriveArchive, root: string, category: OrganizationCategory): Promise<string> {
  const action="drive-category-"+category;
  const existing=()=>repo.db.prepare(`SELECT target_id FROM case_audit WHERE case_id=?1 AND action=?5 AND outcome=?6 AND ${repo.acl()} ORDER BY created_at,id LIMIT 1`).bind(...repo.args(),action,root).first<{target_id:string}>();
  const found=await existing();
  if(found)return found.target_id;
  const generated=await api.generateId();
  // A single guarded statement reserves one Drive ID per root/category. The
  // durable reservation makes both lost responses and concurrent retries safe.
  await repo.db.prepare(`INSERT INTO case_audit SELECT ?5,?1,?2,?6,?7,?8,?9 WHERE ${repo.acl()} AND NOT EXISTS(SELECT 1 FROM case_audit WHERE case_id=?1 AND action=?6 AND outcome=?8)`)
    .bind(...repo.args(),crypto.randomUUID(),action,generated,root,instant()).run();
  const result=await existing();
  if(!result){await repo.authorize();throw new PrivateError(409,"DRIVE_ORGANIZATION_RETRY");}
  return result.target_id;
}

async function organizeOne(env: PrivateEnv, repo: CaseRepository, c: DriveConnection, api: DriveArchive, proposal: OrganizationProposal, receiptId?: string): Promise<void> {
  const get=()=>repo.db.prepare(`SELECT * FROM case_documents WHERE case_id=?1 AND id=?5 AND ${repo.acl()}`).bind(...repo.args(),proposal.documentId).first<Row>();
  let row=await get();
  if(!row || row.status!=="ready" || !row.drive_file_id || !row.folder_id)throw new PrivateError(409,"DOCUMENT_NOT_VERIFIED");
  const permissions=JSON.parse(c.permission_ids_json) as string[];
  await api.archiveFolder(c.folder_id,c.folder_id,permissions);
  let journal: MoveJournal;
  let encrypted=row.session_encrypted;
  if(encrypted){
    try { journal=JSON.parse(await unseal(encrypted,env)) as MoveJournal; }
    catch {throw new PrivateError(409,"DRIVE_ORGANIZATION_PENDING");}
    if(journal.version!=="cbh-drive-move/v1" || journal.root!==c.folder_id || journal.category!==proposal.category || journal.source!==row.folder_id || journal.revision!==row.drive_revision)
      throw new PrivateError(409,"DRIVE_ORGANIZATION_PENDING");
  } else {
    await api.archiveFolder(row.folder_id,c.folder_id,permissions);
    const target=await categoryFolder(repo,api,c.folder_id,proposal.category);
    // Verify before creating a subfolder or moving anything. These checks are
    // repeated after acquiring the document journal and after the Drive move.
    const verified=await api.verify({id:row.drive_file_id,bytes:row.bytes,sha256:row.sha256,mime:row.mime,folder:row.folder_id,allowedPermissionIds:permissions});
    if(verified.parents?.length!==1 || (row.drive_revision && verified.headRevisionId!==row.drive_revision))throw new PrivateError(409,"DRIVE_REVISION_CHANGED");
    if(row.folder_id===target){await api.archiveFolder(target,c.folder_id,permissions,proposal.category);return;}
    await api.movePrecondition(row.drive_file_id,row.folder_id,verified);
    journal={version:"cbh-drive-move/v1",root:c.folder_id,source:row.folder_id,target,category:proposal.category,revision:row.drive_revision};
    encrypted=await seal(JSON.stringify(journal),env);
    const locked=await repo.db.prepare(`UPDATE case_documents SET session_encrypted=?6 WHERE case_id=?1 AND id=?5 AND status='ready' AND folder_id=?7 AND drive_revision IS ?8 AND session_encrypted IS NULL AND ${repo.acl()} RETURNING id`)
      .bind(...repo.args(),row.id,encrypted,row.folder_id,row.drive_revision).first();
    if(!locked)throw new PrivateError(409,"DRIVE_ORGANIZATION_RETRY");
  }
  await api.ensureCategoryFolder(journal.target,c.folder_id,proposal.category,ORGANIZATION_CATEGORIES[proposal.category],permissions);
  await api.archiveFolder(journal.source,c.folder_id,permissions);
  const metadata=await api.metadata(row.drive_file_id);
  if(metadata.parents?.length!==1 || ![journal.source,journal.target].includes(metadata.parents[0]))throw new PrivateError(409,"DRIVE_ARCHIVE_BOUNDARY");
  const currentFolder=metadata.parents[0];
  const checked=await api.verify({id:row.drive_file_id,bytes:row.bytes,sha256:row.sha256,mime:row.mime,folder:currentFolder,allowedPermissionIds:permissions});
  if(journal.revision && checked.headRevisionId!==journal.revision)throw new PrivateError(409,"DRIVE_REVISION_CHANGED");
  await repo.authorize();
  // Re-check the durable journal and document state immediately before the
  // remote mutation; hiding or changing a pending operation blocks the move.
  const latest=await get();
  if(!latest || latest.status!=="ready" || latest.session_encrypted!==encrypted)throw new PrivateError(409,"DRIVE_ORGANIZATION_RETRY");
  if(receiptId)await assertReceiptCurrent(repo,receiptId);
  if(currentFolder!==journal.target)await api.move(row.drive_file_id,journal.source,journal.target,checked);
  await api.archiveFolder(journal.target,c.folder_id,permissions,proposal.category);
  const after=await api.verify({id:row.drive_file_id,bytes:row.bytes,sha256:row.sha256,mime:row.mime,folder:journal.target,allowedPermissionIds:permissions});
  if(after.parents?.length!==1 || (journal.revision && after.headRevisionId!==journal.revision))throw new PrivateError(409,"DRIVE_REVISION_CHANGED");
  const time=instant();
  // No rollback deletes a Drive original. On failure the encrypted journal is
  // retained and retry recognizes an already moved, integrity-verified file.
  const results=await repo.db.batch([
    repo.db.prepare(`UPDATE case_documents SET folder_id=?7,drive_revision=?8,session_encrypted=NULL,updated_at=?9 WHERE case_id=?1 AND id=?5 AND status='ready' AND session_encrypted=?6 AND ${repo.acl()} RETURNING id`)
      .bind(...repo.args(),row.id,encrypted,journal.target,after.headRevisionId??null,time),
    repo.db.prepare(`INSERT INTO case_audit SELECT ?5,?1,?2,'document-organize',?6,'verified',?7 WHERE ${repo.acl()} AND EXISTS(SELECT 1 FROM case_documents WHERE case_id=?1 AND id=?6 AND folder_id=?8 AND updated_at=?7 AND session_encrypted IS NULL AND status='ready')`)
      .bind(...repo.args(),crypto.randomUUID(),row.id,time,journal.target),
  ]);
  if(!results[0].results?.length){await repo.authorize();throw new PrivateError(409,"DRIVE_ORGANIZATION_RETRY");}
}

export async function organizeDocuments(body: Record<string,unknown>, env: PrivateEnv, repo: CaseRepository, c: DriveConnection, api: DriveArchive) {
  if(Object.keys(body).some(key=>!["approved","proposals","receiptId"].includes(key)))throw new PrivateError(400,"INVALID_ORGANIZATION");
  if(body.approved!==true)throw new PrivateError(400,"APPROVAL_REQUIRED");
  let proposals: OrganizationProposal[];
  try {proposals=validateOrganization(body.proposals);}catch{throw new PrivateError(400,"INVALID_ORGANIZATION");}
  if(proposals.length!==1)throw new PrivateError(400,"ORGANIZATION_ONE_FILE_PER_REQUEST");
  if(body.receiptId!==undefined && typeof body.receiptId!=="string")throw new PrivateError(400,"INVALID_ORGANIZATION");
  await repo.authorize();
  const receiptId=body.receiptId as string|undefined;
  if(receiptId){
    const received=await assertReceiptCurrent(repo,receiptId);
    const moves=received.version==="cbh-analysis/v2"?received.documentMoves??[]:[];
    if(proposals.some(proposal=>!moves.some(move=>move.documentId===proposal.documentId && move.category===proposal.category)))throw new PrivateError(400,"ANALYSIS_SOURCE_NOT_ALLOWED");
  }
  const results=[];
  for(const proposal of proposals){
    try {await organizeOne(env,repo,c,api,proposal,receiptId);results.push({documentId:proposal.documentId,status:"organized"});}
    catch(error){
      results.push({documentId:proposal.documentId,status:"failed",error:error instanceof PrivateError?error.code:"DRIVE_ORGANIZATION_RETRY"});
    }
  }
  return {results,originalsPreserved:true};
}
