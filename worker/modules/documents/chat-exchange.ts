import { PrivateError, privateJson, readBounded, readJson, type Principal } from '../auth/contracts';
import { digest, randomToken } from '../auth/crypto';
import { CaseRepository } from '../injury/repository';
import { receiptSourcesSql } from '../injury/analysis-receipts';
import { DriveArchive, type DriveConnection } from './drive';
import { analysisPrompt } from '../../../src/modules/injury/materials/model';
import { CHAT_RESPONSE_LIMIT, CHAT_RESPONSE_VERSION, chatRequestInstructions, readChatReply, sourceStamp, type ChatSources } from '../../../src/modules/injury/materials/chat-contract';

interface ExchangeRow {
  id: string; sources_json: string; source_fingerprint: string; question: string;
  folder_id: string; drive_file_id: string | null; status: 'preparing'|'waiting'|'ready';
  created_at: string; lease_until: string;
}
const now=()=>new Date().toISOString();
const validId=(id:unknown):id is string=>typeof id==='string'&&/^[A-Za-z0-9-]{8,80}$/.test(id);
function safe(row: ExchangeRow) {
  const sources=JSON.parse(row.sources_json) as ChatSources;
  return {id:row.id,status:row.status,createdAt:row.created_at,documentCount:sources.documents.length,noteCount:sources.notes.length,
    url:row.drive_file_id?`https://docs.google.com/document/d/${row.drive_file_id}/edit`:null};
}
async function current(repo:CaseRepository,sources:ChatSources) {
  if(!await repo.db.prepare(`SELECT id FROM case_profiles WHERE id=?1 AND ${repo.acl()} AND ${receiptSourcesSql('?5')}`)
    .bind(...repo.args(),JSON.stringify(sources)).first()){
    await repo.authorize();throw new PrivateError(409,'ANALYSIS_SOURCES_CHANGED');
  }
}
async function mailbox(api:DriveArchive,c:DriveConnection,row:ExchangeRow,id:string,checkRoot=true) {
  if(checkRoot)await api.archiveFolder(c.folder_id,c.folder_id,JSON.parse(c.permission_ids_json));
  const meta=await api.metadata(id),permissions=await api.permissions(id),allowed=new Set(JSON.parse(c.permission_ids_json) as string[]);
  if(meta.mimeType!=='application/vnd.google-apps.document'||meta.trashed||meta.parents?.length!==1||meta.parents[0]!==row.folder_id||row.folder_id!==c.folder_id||meta.appProperties?.cbhChatExchange!==row.id)
    throw new PrivateError(409,'DRIVE_ARCHIVE_BOUNDARY');
  if(!permissions.length||permissions.some(p=>p.type!=='user'||!allowed.has(p.id)))throw new PrivateError(403,'DRIVE_NOT_PRIVATE');
  return meta;
}
async function verifyOriginals(repo:CaseRepository,api:DriveArchive,c:DriveConnection,sources:ChatSources) {
  const rows=(await repo.db.prepare(`SELECT id,drive_file_id,drive_revision,folder_id,sha256,bytes,mime FROM case_documents WHERE case_id=?1 AND status='ready' AND session_encrypted IS NULL AND id IN(SELECT json_extract(value,'$.id') FROM json_each(?5,'$.documents')) AND ${repo.acl()}`)
    .bind(...repo.args(),JSON.stringify(sources)).all<{id:string;drive_file_id:string;drive_revision:string|null;folder_id:string;sha256:string;bytes:number;mime:string}>()).results;
  if(rows.length!==sources.documents.length)throw new PrivateError(409,'ANALYSIS_SOURCES_CHANGED');
  const allowed=new Set(JSON.parse(c.permission_ids_json) as string[]);
  for(const row of rows){
    const meta=await api.metadata(row.drive_file_id),permissions=meta.permissions;
    if(meta.trashed||meta.mimeType!==row.mime||Number(meta.size)!==row.bytes||meta.parents?.length!==1||meta.parents[0]!==row.folder_id)throw new PrivateError(409,'DRIVE_INTEGRITY_FAILED');
    // files.permissions is returned for this owner-managed My Drive archive.
    // Shared drives or an omitted ACL fail closed, rather than adding twenty
    // fallback permission calls and exceeding Workers Free with D1/auth calls.
    if(!permissions?.length||permissions.some(p=>p.type!=='user'||!allowed.has(p.id)))throw new PrivateError(403,'DRIVE_NOT_PRIVATE');
    if(row.drive_revision&&meta.headRevisionId!==row.drive_revision||meta.sha256Checksum&&meta.sha256Checksum.toLowerCase()!==row.sha256)throw new PrivateError(409,'DRIVE_REVISION_CHANGED');
    // A trusted immutable binary revision or checksum is mandatory. Do not
    // download every binary here: 20 originals must fit Workers Free limits.
    if(!row.drive_revision&&!meta.sha256Checksum)throw new PrivateError(409,'DRIVE_CONCURRENT_CHECK_UNAVAILABLE');
  }
}
async function sourcePrompt(repo:CaseRepository,row:ExchangeRow) {
  const sources=JSON.parse(row.sources_json) as ChatSources;
  await current(repo,sources);
  const documents=(await repo.db.prepare(`SELECT id,filename,sha256,drive_file_id FROM case_documents WHERE case_id=?1 AND id IN(SELECT json_extract(value,'$.id') FROM json_each(?5,'$.documents')) AND ${repo.acl()}`)
    .bind(...repo.args(),row.sources_json).all<{id:string;filename:string;sha256:string;drive_file_id:string}>()).results;
  const notes=(await repo.db.prepare(`SELECT id,payload_json,revision FROM case_records WHERE case_id=?1 AND id IN(SELECT json_extract(value,'$.id') FROM json_each(?5,'$.notes')) AND ${repo.acl()}`)
    .bind(...repo.args(),row.sources_json).all<{id:string;payload_json:string;revision:number}>()).results;
  return analysisPrompt(documents.map(d=>({...d,url:`https://drive.google.com/file/d/${d.drive_file_id}/view`})),notes.map(n=>{
    const p=JSON.parse(n.payload_json);return {id:n.id,title:String(p.title),body:String(p.body)+'\n'+JSON.stringify(p.data),revision:n.revision};
  }),row.question);
}
export async function handleChatExchanges(request:Request,p:Principal,repo:CaseRepository,path:string[],drive:()=>Promise<{c:DriveConnection;api:DriveArchive}>):Promise<Response>{
  await repo.authorize();
  if(path.length===2&&path[1]==='resume'&&request.method==='POST'){
    await readJson(request);
    if(!validId(path[0]))throw new PrivateError(404,'NOT_FOUND');
    const row=await repo.db.prepare(`SELECT * FROM case_chat_exchanges WHERE case_id=?1 AND id=?5 AND ${repo.acl()}`).bind(...repo.args(),path[0]).first<ExchangeRow>();
    if(!row)throw new PrivateError(404,'NOT_FOUND');
    const sources=JSON.parse(row.sources_json) as ChatSources;
    await current(repo,sources);
    const retry=new Request(request.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:row.id,documentIds:sources.documents.map(d=>d.id),notes:sources.notes,question:row.question})});
    return handleChatExchanges(retry,p,repo,[],drive);
  }
  if(!path.length&&request.method==='GET'){
    const rows=(await repo.db.prepare(`SELECT * FROM case_chat_exchanges WHERE case_id=?1 AND ${repo.acl()} ORDER BY created_at DESC LIMIT 30`).bind(...repo.args()).all<ExchangeRow>()).results;
    return privateJson({exchanges:rows.map(safe)});
  }
  if(path.length===2&&path[1]==='request'&&request.method==='GET'){
    if(!validId(path[0]))throw new PrivateError(404,'NOT_FOUND');
    const row=await repo.db.prepare(`SELECT * FROM case_chat_exchanges WHERE case_id=?1 AND id=?5 AND ${repo.acl()}`).bind(...repo.args(),path[0]).first<ExchangeRow>();
    if(!row?.drive_file_id)throw new PrivateError(409,'CHAT_PREPARING');
    const {c,api}=await drive();await mailbox(api,c,row,row.drive_file_id);
    await verifyOriginals(repo,api,c,JSON.parse(row.sources_json) as ChatSources);
    const analysis=await sourcePrompt(repo,row),value=safe(row);
    return privateJson({prompt:chatRequestInstructions(value.url!,row.id,row.source_fingerprint,analysis)});
  }
  if(!path.length&&request.method==='POST'){
    const body=await readJson(request);
    if(!validId(body.requestId)||!Array.isArray(body.documentIds)||body.documentIds.length>20||body.documentIds.some(id=>!validId(id))||new Set(body.documentIds).size!==body.documentIds.length||!Array.isArray(body.notes)||body.notes.length>40||!body.documentIds.length&&!body.notes.length||typeof body.question!=='string'||body.question.length>1000||Object.keys(body).some(k=>!['requestId','documentIds','notes','question'].includes(k)))throw new PrivateError(400,'INVALID_ANALYSIS_SOURCES');
    const notes:ChatSources['notes']=[];
    for(const n of body.notes){
      if(!n||typeof n!=='object'||Array.isArray(n)||Object.keys(n).some(k=>!['id','revision'].includes(k))||!validId(n.id)||n.id.startsWith('analysis-receipt-')||!Number.isSafeInteger(n.revision)||n.revision<1||notes.some(v=>v.id===n.id))throw new PrivateError(400,'INVALID_ANALYSIS_SOURCES');
      notes.push({id:n.id,revision:n.revision});
    }
    const documents=(await repo.db.prepare(`SELECT id,sha256,bytes FROM case_documents WHERE case_id=?1 AND status='ready' AND session_encrypted IS NULL AND id IN(SELECT value FROM json_each(?5)) AND ${repo.acl()}`)
      .bind(...repo.args(),JSON.stringify(body.documentIds)).all<ChatSources['documents'][number]>()).results;
    if(documents.length!==body.documentIds.length)throw new PrivateError(400,'VERIFIED_DOCUMENT_REQUIRED');
    const sources={documents,notes};await current(repo,sources);
    const fingerprint=await digest(sourceStamp(sources)),{c,api}=await drive(),createdAt=now();
    await verifyOriginals(repo,api,c,sources);
    let row=await repo.db.prepare(`SELECT * FROM case_chat_exchanges WHERE case_id=?1 AND id=?5 AND ${repo.acl()}`).bind(...repo.args(),body.requestId).first<ExchangeRow>();
    if(row&&(row.source_fingerprint!==fingerprint||row.question!==body.question||row.folder_id!==c.folder_id))throw new PrivateError(409,'REVISION_CONFLICT');
    const prospective:ExchangeRow=row??{id:body.requestId,sources_json:sourceStamp(sources),source_fingerprint:fingerprint,question:body.question,folder_id:c.folder_id,drive_file_id:null,status:'preparing',created_at:createdAt,lease_until:''};
    const analysis=await sourcePrompt(repo,prospective);
    const initial=JSON.stringify({version:CHAT_RESPONSE_VERSION,requestId:prospective.id,sourceFingerprint:fingerprint,status:'waiting',instructions:analysis,answer:'',result:null},null,2);
    const maximumUrl='https://docs.google.com/document/d/'+'x'.repeat(256)+'/edit';
    if([initial,chatRequestInstructions(maximumUrl,prospective.id,fingerprint,analysis)].some(value=>new TextEncoder().encode(value).length>CHAT_RESPONSE_LIMIT))throw new PrivateError(413,'REQUEST_TOO_LARGE');
    if(!row){
      row=await repo.db.prepare(`INSERT INTO case_chat_exchanges SELECT ?5,?1,?2,?6,?7,?8,?9,NULL,'preparing','',?10,?10 WHERE ${repo.acl()} ON CONFLICT(id) DO NOTHING RETURNING *`)
        .bind(...repo.args(),body.requestId,sourceStamp(sources),fingerprint,body.question,c.folder_id,createdAt).first<ExchangeRow>();
      if(!row)row=await repo.db.prepare(`SELECT * FROM case_chat_exchanges WHERE case_id=?1 AND id=?5 AND ${repo.acl()}`).bind(...repo.args(),body.requestId).first<ExchangeRow>();
    }
    if(!row)throw new PrivateError(403,'CASE_ACCESS_DENIED');
    if(row.source_fingerprint!==fingerprint||row.question!==body.question)throw new PrivateError(409,'REVISION_CONFLICT');
    if(!row.drive_file_id){
      // All bounded Drive calls (including privacy verification after create)
      // fit within this lease; a 90s lease could expire during a slow upload.
      const lease=new Date(Date.now()+300000).toISOString();
      const acquired=await repo.db.prepare(`UPDATE case_chat_exchanges SET lease_until=?6 WHERE case_id=?1 AND id=?5 AND drive_file_id IS NULL AND lease_until<?7 AND ${repo.acl()} RETURNING id`).bind(...repo.args(),row.id,lease,now()).first();
      if(!acquired)throw new PrivateError(409,'CHAT_PREPARING');
      await api.archiveFolder(c.folder_id,c.folder_id,JSON.parse(c.permission_ids_json));
      // Workspace documents cannot use pre-generated file IDs. A private app
      // property and a timed lease recover an indeterminate create safely.
      const query=`trashed=false and appProperties has { key='cbhChatExchange' and value='${row.id}' }`;
      const found=await (await api.request('drive/v3/files?'+new URLSearchParams({q:query,fields:'files(id),nextPageToken',pageSize:'2'}))).json() as {files:Array<{id:string}>;nextPageToken?:string};
      if(found.nextPageToken||found.files.length>1)throw new PrivateError(409,'CHAT_DUPLICATE_MAILBOX');
      let fileId=found.files[0]?.id;
      if(!fileId){
        const boundary='cbh-'+crypto.randomUUID();
        const ownsLease=await repo.db.prepare(`SELECT id FROM case_chat_exchanges WHERE case_id=?1 AND id=?5 AND drive_file_id IS NULL AND lease_until=?6 AND lease_until>?7 AND ${repo.acl()}`).bind(...repo.args(),row.id,lease,now()).first();
        if(!ownsLease)throw new PrivateError(409,'CHAT_PREPARING');
        const metadata={name:'ComeBackHome 답변 '+createdAt.slice(0,10),mimeType:'application/vnd.google-apps.document',parents:[c.folder_id],appProperties:{cbhChatExchange:row.id}};
        const body=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${initial}\r\n--${boundary}--`;
        const result=await(await api.request('upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body})).json() as {id:string};
        fileId=result.id;
      }
      if(!fileId||fileId.length>256||!/^[A-Za-z0-9_-]+$/.test(fileId))throw new PrivateError(502,'DRIVE_REQUEST_FAILED');
      await mailbox(api,c,row,fileId);await current(repo,sources);
      const updated=await repo.db.prepare(`UPDATE case_chat_exchanges SET drive_file_id=?6,status='waiting',lease_until='',updated_at=?7 WHERE case_id=?1 AND id=?5 AND lease_until=?8 AND ${repo.acl()} RETURNING id`).bind(...repo.args(),row.id,fileId,now(),lease).first();
      if(!updated)throw new PrivateError(409,'CHAT_PREPARING');
      row={...row,drive_file_id:fileId,status:'waiting'};
    }else await mailbox(api,c,row,row.drive_file_id);
    const value=safe(row),prompt=chatRequestInstructions(value.url!,row.id,fingerprint,analysis);
    if(new TextEncoder().encode(prompt).length>CHAT_RESPONSE_LIMIT)throw new PrivateError(413,'REQUEST_TOO_LARGE');
    await repo.audit('chat-request',row.id);
    return privateJson({...value,prompt},201);
  }
  if(path.length===2&&path[1]==='read'&&request.method==='POST'){
    await readJson(request);
    if(!validId(path[0]))throw new PrivateError(404,'NOT_FOUND');
    const row=await repo.db.prepare(`SELECT * FROM case_chat_exchanges WHERE case_id=?1 AND id=?5 AND ${repo.acl()}`).bind(...repo.args(),path[0]).first<ExchangeRow>();
    if(!row?.drive_file_id)throw new PrivateError(409,'CHAT_PREPARING');
    const sources=JSON.parse(row.sources_json) as ChatSources;await current(repo,sources);
    const {c,api}=await drive(),before=await mailbox(api,c,row,row.drive_file_id);
    const bytes=await readBounded(await api.request(`drive/v3/files/${row.drive_file_id}/export?mimeType=text%2Fplain`),CHAT_RESPONSE_LIMIT);
    const after=await mailbox(api,c,row,row.drive_file_id,false);
    if(!before.version||before.version!==after.version)throw new PrivateError(409,'CHAT_REPLY_CHANGED');
    let reply;try{reply=readChatReply(new TextDecoder('utf-8',{fatal:true}).decode(bytes),row.id,row.source_fingerprint,sources);}catch{throw new PrivateError(400,'CHAT_REPLY_INVALID');}
    if(!reply)return privateJson({status:'waiting',answer:null});
    await verifyOriginals(repo,api,c,sources);
    await current(repo,sources);
    let receiptId:string|null=null;
    if(reply.result){
      // Reuse the reviewed importer and its atomic source/session guard. Each
      // reader receives their own session-bound receipt; no public callback.
      const resultHash=await digest(JSON.stringify(reply.result));
      receiptId='analysis-receipt-'+(await digest(row.id+p.sessionHash+resultHash)).slice(0,40);
      const time=now(),envelope={version:'cbh-analysis-receipt/v1',creatorId:p.id,sessionHash:p.sessionHash,authEpoch:p.authEpoch,tokenHash:await digest(randomToken()),createdAt:time,expiresAt:time,status:'received',...sources,result:reply.result,resultHash};
      const inserted=await repo.db.prepare(`INSERT INTO case_records SELECT ?5,?1,'analysis_receipt',?6,1,?2,?7,NULL WHERE ${repo.acl()} AND ${receiptSourcesSql('?6')} ON CONFLICT(id) DO NOTHING RETURNING id`).bind(...repo.args(),receiptId,JSON.stringify(envelope),time).first();
      if(!inserted)await current(repo,sources);
    }
    await repo.db.prepare(`UPDATE case_chat_exchanges SET status='ready',updated_at=?6 WHERE case_id=?1 AND id=?5 AND ${repo.acl()}`).bind(...repo.args(),row.id,now()).run();
    await repo.authorize();await repo.audit('chat-answer-read',row.id);
    return privateJson({status:'ready',answer:reply.answer,result:reply.result,receiptId,sourceFingerprint:row.source_fingerprint});
  }
  throw new PrivateError(404,'NOT_FOUND');
}
