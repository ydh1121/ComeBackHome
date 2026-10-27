import { PrivateError, privateJson, readJson, type Principal, type PrivateEnv } from '../auth/contracts';
import { digest, randomToken } from '../auth/crypto';
import { CaseRepository } from './repository';
import { reviewAnalysis, type AnalysisResult } from '../../../src/modules/injury/materials/model';

const PREFIX = 'analysis-receipt-';
const KIND = 'analysis_receipt';
const TTL_MS = 60 * 60 * 1000;
const instant = () => new Date().toISOString();
interface DocumentGrant { id: string; sha256: string; bytes: number }
interface NoteGrant { id: string; revision: number }
interface Envelope {
  version: 'cbh-analysis-receipt/v1'; creatorId: string; sessionHash: string; authEpoch: number;
  tokenHash: string; createdAt: string; expiresAt: string; status: 'waiting' | 'received' | 'revoked';
  documents: DocumentGrant[]; notes: NoteGrant[]; result?: AnalysisResult; resultHash?: string;
}
interface ReceiptRow { id: string; case_id: string; payload_json: string; revision: number; archived_at: string | null }
export function isAnalysisReceiptRecord(record: { id?: string; kind?: string }): boolean {
  return record.kind === KIND || !!record.id?.startsWith(PREFIX);
}
function envelope(row: ReceiptRow): Envelope { return JSON.parse(row.payload_json) as Envelope; }
function validId(id: unknown): id is string { return typeof id === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(id); }
function receiptId(id: string) { if (!id.startsWith(PREFIX) || !validId(id)) throw new PrivateError(404, 'ANALYSIS_RECEIPT_NOT_FOUND'); }
function safe(row: ReceiptRow, value: Envelope) {
  return { id: row.id, status: value.status === 'waiting' && value.expiresAt <= instant() ? 'expired' : value.status,
    createdAt: value.createdAt, expiresAt: value.expiresAt, documentIds: value.documents.map(d => d.id), noteCount: value.notes.length };
}
async function getOwned(repo: CaseRepository, id: string): Promise<{row: ReceiptRow; value: Envelope}> {
  receiptId(id);
  const row = await repo.db.prepare(`SELECT id,case_id,payload_json,revision,archived_at FROM case_records WHERE id=?5 AND case_id=?1 AND kind='${KIND}' AND ${repo.acl()} AND json_extract(payload_json,'$.creatorId')=?2`)
    .bind(...repo.args(), id).first<ReceiptRow>();
  if (!row) throw new PrivateError(404, 'ANALYSIS_RECEIPT_NOT_FOUND');
  return { row, value: envelope(row) };
}
// JSON sets are checked in one D1 statement; a full source grant stays within
// the Workers Free request query budget instead of looping over every source.
export function receiptSourcesSql(value: string, caseId = '?1'): string {
  return `NOT EXISTS(SELECT 1 FROM json_each(${value},'$.documents') jd WHERE NOT EXISTS(
    SELECT 1 FROM case_documents d WHERE d.id=json_extract(jd.value,'$.id') AND d.case_id=${caseId}
    AND d.status='ready' AND d.sha256=json_extract(jd.value,'$.sha256') AND d.bytes=json_extract(jd.value,'$.bytes')))
    AND NOT EXISTS(SELECT 1 FROM json_each(${value},'$.notes') jn WHERE NOT EXISTS(
    SELECT 1 FROM case_records n WHERE n.id=json_extract(jn.value,'$.id') AND n.case_id=${caseId}
    AND n.revision=json_extract(jn.value,'$.revision') AND n.archived_at IS NULL AND n.kind<>'${KIND}' AND n.id NOT LIKE '${PREFIX}%'))`;
}
export function receiptApplyGuard(): string {
  return `EXISTS(SELECT 1 FROM case_records ar WHERE ar.id=?9 AND ar.case_id=?1 AND ar.kind='${KIND}'
    AND json_extract(ar.payload_json,'$.creatorId')=?2 AND json_extract(ar.payload_json,'$.status')='received'
    AND json_extract(ar.payload_json,'$.authEpoch')=?3
    AND EXISTS(SELECT 1 FROM auth_sessions s CROSS JOIN auth_policy ap WHERE s.token_hash=json_extract(ar.payload_json,'$.sessionHash')
      AND s.user_id=?2 AND s.auth_epoch=?3 AND s.revoked_at IS NULL AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND julianday(s.last_seen_at)>julianday('now')-ap.idle_hours/24.0)
    AND ${receiptSourcesSql('ar.payload_json')})`;
}
async function sourcesCurrent(repo: CaseRepository, value: Envelope): Promise<boolean> {
  return !!await repo.db.prepare(`SELECT id FROM case_profiles WHERE id=?1 AND ${repo.acl()} AND ${receiptSourcesSql('?5')}`)
    .bind(...repo.args(),JSON.stringify(value)).first();
}
async function grantPrincipal(env: PrivateEnv, value: Envelope): Promise<Principal> {
  const user = await env.DB.prepare('SELECT id,login_id,role,auth_epoch,must_change_password FROM auth_users WHERE id=?1 AND disabled=0 AND auth_epoch=?2 AND must_change_password=0')
    .bind(value.creatorId, value.authEpoch).first<{id:string; login_id:string;role:'admin'|'member';auth_epoch:number;must_change_password:number}>();
  if (!user) throw new PrivateError(401, 'ANALYSIS_RECEIPT_REVOKED');
  return { id:user.id,loginId:user.login_id,role:user.role,authEpoch:user.auth_epoch,mustChangePassword:false,sessionHash:value.sessionHash };
}
// On review/save, the original session must still be valid. Logout, password
// changes and consent revocation invalidate a pending capability immediately.
export async function assertReceiptCurrent(repo: CaseRepository, id: string): Promise<AnalysisResult> {
  const {value} = await getOwned(repo,id);
  if(value.status!=='received'||!value.result) throw new PrivateError(409,'ANALYSIS_RESULT_NOT_READY');
  const bound = new CaseRepository(repo.db,{...repo.principal,sessionHash:value.sessionHash,authEpoch:value.authEpoch},repo.caseId);
  await bound.authorize();
  if(!await sourcesCurrent(repo,value)) throw new PrivateError(409,'ANALYSIS_SOURCES_CHANGED');
  return value.result;
}
export async function handleAnalysisReceipts(request:Request, env:PrivateEnv, p:Principal, repo:CaseRepository, path:string[]):Promise<Response> {
  if (!path.length && request.method==='POST') {
    const body=await readJson(request);
    if(Object.keys(body).some(k=>!['documentIds','notes'].includes(k))||!Array.isArray(body.documentIds)||!Array.isArray(body.notes)||body.documentIds.length>20||body.notes.length>40||body.documentIds.length+body.notes.length===0)
      throw new PrivateError(400,'INVALID_ANALYSIS_SOURCES');
    const documentIds=body.documentIds as unknown[], notes=body.notes as unknown[];
    if(documentIds.some(id=>!validId(id))||new Set(documentIds).size!==documentIds.length)throw new PrivateError(400,'INVALID_ANALYSIS_SOURCES');
    const noteGrants:NoteGrant[]=[];
    for(const note of notes){
      if(!note||typeof note!=='object'||Array.isArray(note))throw new PrivateError(400,'INVALID_ANALYSIS_SOURCES');
      const n=note as NoteGrant;
      if(Object.keys(n).some(k=>!['id','revision'].includes(k))||!validId(n.id)||isAnalysisReceiptRecord(n)||!Number.isSafeInteger(n.revision)||n.revision<1||noteGrants.some(v=>v.id===n.id))throw new PrivateError(400,'INVALID_ANALYSIS_SOURCES');
      noteGrants.push({id:n.id,revision:n.revision});
    }
    const documents=(await env.DB.prepare(`SELECT id,sha256,bytes FROM case_documents WHERE id IN(SELECT value FROM json_each(?5)) AND case_id=?1 AND status='ready' AND ${repo.acl()}`)
      .bind(...repo.args(),JSON.stringify(documentIds)).all<DocumentGrant>()).results;
    if(documents.length!==documentIds.length)throw new PrivateError(400,'VERIFIED_DOCUMENT_REQUIRED');
    const foundNotes=(await env.DB.prepare(`SELECT n.id FROM case_records n JOIN json_each(?5) j ON n.id=json_extract(j.value,'$.id') AND n.revision=json_extract(j.value,'$.revision') WHERE n.case_id=?1 AND n.archived_at IS NULL AND n.kind<>'${KIND}' AND n.id NOT LIKE '${PREFIX}%' AND ${repo.acl()}`)
      .bind(...repo.args(),JSON.stringify(noteGrants)).all()).results;
    if(foundNotes.length!==noteGrants.length)throw new PrivateError(409,'ANALYSIS_SOURCES_CHANGED');
    const token=randomToken(),createdAt=instant(),id=PREFIX+crypto.randomUUID();
    const value:Envelope={version:'cbh-analysis-receipt/v1',creatorId:p.id,sessionHash:p.sessionHash,authEpoch:p.authEpoch,tokenHash:await digest(token),createdAt,expiresAt:new Date(Date.now()+TTL_MS).toISOString(),status:'waiting',documents,notes:noteGrants};
    const inserted=await env.DB.prepare(`INSERT INTO case_records SELECT ?5,?1,'${KIND}',?6,1,?2,?7,NULL WHERE ${repo.acl()} AND (SELECT COUNT(*) FROM case_records WHERE case_id=?1 AND kind='${KIND}' AND json_extract(payload_json,'$.creatorId')=?2 AND json_extract(payload_json,'$.status')='waiting' AND json_extract(payload_json,'$.expiresAt')>?7)<5 RETURNING id`)
      .bind(...repo.args(),id,JSON.stringify(value),createdAt).first();
    if(!inserted){await repo.authorize();throw new PrivateError(429,'ANALYSIS_RECEIPT_LIMIT');}
    return privateJson({id,token,expiresAt:value.expiresAt,endpoint:new URL('/api/private/analysis-return/'+id,request.url).href},201);
  }
  if(!path.length&&request.method==='GET'){
    const rows=(await env.DB.prepare(`SELECT id,case_id,payload_json,revision,archived_at FROM case_records WHERE case_id=?1 AND kind='${KIND}' AND ${repo.acl()} AND json_extract(payload_json,'$.creatorId')=?2 ORDER BY updated_at DESC LIMIT 30`).bind(...repo.args()).all<ReceiptRow>()).results;
    return privateJson({receipts:rows.map(row=>safe(row,envelope(row)))});
  }
  if(path.length===1&&request.method==='GET'){
    const {row,value}=await getOwned(repo,path[0]);
    let stale=!await sourcesCurrent(repo,value);
    if(value.status==='received') {try{await assertReceiptCurrent(repo,path[0]);}catch{stale=true;}}
    return privateJson({...safe(row,value),stale,result:value.status==='received'&&!stale?value.result:null});
  }
  if(path.length===2&&path[1]==='revoke'&&request.method==='POST'){
    await readJson(request);
    const {row,value}=await getOwned(repo,path[0]);
    if(value.status==='revoked')return privateJson({ok:true});
    const next={...value,status:'revoked'};
    const changed=await env.DB.prepare(`UPDATE case_records SET payload_json=?6,revision=revision+1,updated_by=?2,updated_at=?7 WHERE id=?5 AND case_id=?1 AND kind='${KIND}' AND revision=?8 AND ${repo.acl()} RETURNING id`).bind(...repo.args(),row.id,JSON.stringify(next),instant(),row.revision).first();
    if(!changed)throw new PrivateError(409,'REVISION_CONFLICT');
    return privateJson({ok:true});
  }
  throw new PrivateError(404,'NOT_FOUND');
}

// Only this dedicated ingress accepts a capability in place of browser cookies.
// It cannot apply records, move Drive files or mutate the ledger.
export async function receiveAnalysis(request:Request,env:PrivateEnv,id:string):Promise<Response>{
  if(request.method!=='POST')throw new PrivateError(405,'METHOD_NOT_ALLOWED');
  receiptId(id);
  if(env.MUTATIONS_ENABLED==='0')throw new PrivateError(503,'WRITES_DISABLED');
  const origin=request.headers.get('Origin');
  if(origin&&origin!==new URL(request.url).origin)throw new PrivateError(403,'ORIGIN_REJECTED');
  if(request.headers.get('Sec-Fetch-Site')==='cross-site')throw new PrivateError(403,'ORIGIN_REJECTED');
  const header=request.headers.get('Authorization')??'';
  if(!/^Bearer [A-Za-z0-9_-]{43}$/.test(header))throw new PrivateError(401,'ANALYSIS_RECEIPT_INVALID');
  const tokenHash=await digest(header.slice(7));
  const row=await env.DB.prepare(`SELECT id,case_id,payload_json,revision,archived_at FROM case_records WHERE id=?1 AND kind='${KIND}' AND json_extract(payload_json,'$.tokenHash')=?2`).bind(id,tokenHash).first<ReceiptRow>();
  if(!row)throw new PrivateError(401,'ANALYSIS_RECEIPT_INVALID');
  const value=envelope(row);
  if(value.status==='revoked'||value.expiresAt<=instant())throw new PrivateError(410,'ANALYSIS_RECEIPT_EXPIRED');
  const principal=await grantPrincipal(env,value),repo=new CaseRepository(env.DB,principal,row.case_id);
  await repo.authorize();
  if(!await sourcesCurrent(repo,value))throw new PrivateError(409,'ANALYSIS_SOURCES_CHANGED');
  const raw=await readJson(request);
  let result:AnalysisResult;
  try{result=reviewAnalysis(raw).result;}catch{throw new PrivateError(400,'INVALID_ANALYSIS');}
  const allowed=new Set(value.documents.map(d=>d.id));
  const normalized=reviewAnalysis(result);
  if(normalized.seed.records.some(r=>r.payload.sourceIds.some(id=>!allowed.has(id))||r.payload.data.sourceDocument&&!allowed.has(String(r.payload.data.sourceDocument))))throw new PrivateError(400,'ANALYSIS_SOURCE_NOT_ALLOWED');
  // reviewAnalysis has already validated every @ref target, kind and acyclic
  // dependency. These refer to new proposals, not existing ungranted records.
  const allowedNotes=new Set(value.notes.map(n=>n.id));
  if(normalized.seed.records.some(r=>['employmentId','claimId','relatedId','relatedMessage'].some(key=>r.payload.data[key]&&!String(r.payload.data[key]).startsWith('@')&&!allowedNotes.has(String(r.payload.data[key])))))throw new PrivateError(400,'ANALYSIS_SOURCE_NOT_ALLOWED');
  const moves=(result as AnalysisResult & {documentMoves?:Array<{documentId:string}>}).documentMoves??[];
  if(moves.some(move=>!allowed.has(move.documentId)))throw new PrivateError(400,'ANALYSIS_SOURCE_NOT_ALLOWED');
  const resultHash=await digest(JSON.stringify(result));
  if(value.status==='received'){
    if(value.resultHash!==resultHash)throw new PrivateError(409,'ANALYSIS_RECEIPT_ALREADY_USED');
    return privateJson({accepted:true,duplicate:true,reviewRequired:true},202);
  }
  const next:Envelope={...value,status:'received',result,resultHash};
  const changed=await env.DB.prepare(`UPDATE case_records SET payload_json=?6,revision=revision+1,updated_by=?2,updated_at=?7 WHERE id=?5 AND case_id=?1 AND kind='${KIND}' AND revision=?8 AND json_extract(payload_json,'$.status')='waiting' AND json_extract(payload_json,'$.expiresAt')>?7 AND ${repo.acl()} AND ${receiptSourcesSql('case_records.payload_json')} RETURNING id`).bind(...repo.args(),row.id,JSON.stringify(next),instant(),row.revision).first();
  if(!changed){await repo.authorize();throw new PrivateError(409,'ANALYSIS_RECEIPT_ALREADY_USED');}
  return privateJson({accepted:true,duplicate:false,reviewRequired:true},202);
}
