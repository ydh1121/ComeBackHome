import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {createServer} from 'vite';

const vite=await createServer({appType:'custom',logLevel:'error',server:{middlewareMode:true}});
const sql=new DatabaseSync(':memory:');
let dbCalls=0,externalCalls=0;
const db={prepare(source){let values=[];return {bind(...args){values=args;return this;},compile(){dbCalls++;const bound=[];const query=source.replace(/\?(\d+)/g,(_,n)=>{bound.push(values[Number(n)-1]);return '?';});return [sql.prepare(query),bound];},async all(){const[q,a]=this.compile();return{success:true,results:q.all(...a)};},async first(){return(await this.all()).results[0]??null;},async run(){const[q,a]=this.compile();return /RETURNING/i.test(source)?{success:true,results:q.all(...a)}:{success:true,meta:q.run(...a)};}};},async batch(statements){sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
let count=0;const check=(actual,expected)=>{assert.deepEqual(actual,expected);count++;};
const expect=async(code,fn)=>{await assert.rejects(fn,e=>e.code===code);count++;};
try{
  sql.exec(await readFile('db/migrations/0012_private_work_modules.sql','utf8'));
  sql.exec(await readFile('db/migrations/0014_chat_exchanges.sql','utf8'));
  const current=new Date().toISOString(),future=new Date(Date.now()+86400000).toISOString();
  sql.prepare('INSERT INTO auth_users VALUES(?,?,?,?,?,?,?)').run('user-admin','ydh1121','admin',0,0,0,current);
  sql.prepare('INSERT INTO auth_users VALUES(?,?,?,?,?,?,?)').run('user-member','yvonne','member',0,0,0,current);
  for(const id of ['admin','member'])sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?,?,?,?,?,?)').run('session-'+id,'user-'+id,0,'synthetic',0,current,current,future,null);
  sql.prepare('INSERT INTO case_profiles VALUES(?,?,?)').run('case-synthetic','user-member',current);
  sql.prepare('INSERT INTO case_consents VALUES(?,?,?,?,?,?,?)').run('case-synthetic',1,'test','test',1,'user-member',current);
  sql.prepare('INSERT INTO case_documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('document-one','case-synthetic','synthetic.pdf','application/pdf',12,'a'.repeat(64),'original-one','1','private-root','ready',null,'user-member',current,current);
  const {CaseRepository}=await vite.ssrLoadModule('/worker/modules/injury/repository.ts');
  const {handleChatExchanges}=await vite.ssrLoadModule('/worker/modules/documents/chat-exchange.ts');
  const {DriveArchive}=await vite.ssrLoadModule('/worker/modules/documents/drive.ts');
  const {handleCase}=await vite.ssrLoadModule('/worker/modules/injury/service.ts');
  const {readChatReply,sourceStamp,unwrapManualReply}=await vite.ssrLoadModule('/src/modules/injury/materials/chat-contract.ts');
  const admin={id:'user-admin',loginId:'ydh1121',role:'admin',mustChangePassword:false,authEpoch:0,sessionHash:'session-admin'};
  const member={...admin,id:'user-member',loginId:'yvonne',role:'member',sessionHash:'session-member'};
  const repo=new CaseRepository(db,admin,'case-synthetic'),memberRepo=new CaseRepository(db,member,'case-synthetic');
  const files=new Map();let creations=0,failAfterCreate=false,expose=false,onExport=null,originalRevision='1';
  const perms=[{id:'private-owner',type:'user',role:'owner'}],extraOriginals=new Map();
  const fetcher=async(url,init={})=>{
    externalCalls++;const u=new URL(url),path=u.pathname;
    if(u.origin==='https://oauth2.googleapis.com')return Response.json({access_token:'synthetic-access'});
    if(path==='/drive/v3/files'&&init.method!=='POST'){
      const key=u.searchParams.get('q').match(/value='([^']+)'/)[1];
      return Response.json({files:[...files.values()].filter(f=>f.meta.appProperties.cbhChatExchange===key).map(f=>({id:f.meta.id}))});
    }
    if(path==='/upload/drive/v3/files'){
      creations++;const chunks=String(init.body).split('\r\n\r\n');
      const metadata=JSON.parse(chunks[1].split('\r\n--')[0]),text=chunks[2].split('\r\n--')[0],id='mailbox-'+creations;
      files.set(id,{meta:{...metadata,id,version:'1'},text});
      if(failAfterCreate){failAfterCreate=false;throw Error('synthetic lost response');}
      return Response.json({id});
    }
    const id=path.match(/\/files\/([^/]+)/)?.[1];
    if(path.endsWith('/permissions'))return Response.json({permissions:expose&&id!=='private-root'?[...perms,{id:'public',type:'anyone',role:'reader'}]:perms});
    if(path.endsWith('/export')){const text=files.get(id).text;if(onExport){const fn=onExport;onExport=null;fn();}return new Response(text);}
    if(id==='private-root')return Response.json({id,name:'private',mimeType:'application/vnd.google-apps.folder',parents:[],version:'1'});
    if(id==='original-one')return Response.json({id,name:'synthetic.pdf',mimeType:'application/pdf',parents:['private-root'],size:'12',sha256Checksum:'a'.repeat(64),headRevisionId:originalRevision,permissions:perms});
    if(extraOriginals.has(id))return Response.json(extraOriginals.get(id));
    if(files.has(id))return Response.json(files.get(id).meta);
    return new Response('',{status:404});
  };
  const connection={folder_id:'private-root',permission_ids_json:JSON.stringify(['private-owner']),refresh_token_encrypted:'unused',google_subject:'synthetic'};
  const drive=async()=>({c:connection,api:new DriveArchive('synthetic-token',fetcher)});
  const request=(method,body)=>new Request('https://local.invalid/api/private/case/documents/chat-exchanges',{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const call=(method,body,path=[],principal=admin,repository=repo)=>handleChatExchanges(request(method,body),principal,repository,path,drive);
  const body={requestId:'request-synthetic-01',documentIds:['document-one'],notes:[],question:'검토할 내용을 알려주세요.'};
  const created=await(await call('POST',body)).json();check(created.status,'waiting');check(creations,1);assert.match(created.prompt,/OpenAI API나 별도 API 키는 사용하지/);count++;
  check((await(await call('POST',body)).json()).id,created.id);check(creations,1);
  check((await(await call('GET',undefined,[],member,memberRepo)).json()).exchanges.length,1);
  check((await(await call('POST',{},[created.id,'read'])).json()).status,'waiting');
  check(sql.prepare("SELECT COUNT(*) n FROM case_records WHERE kind<>'analysis_receipt'").get().n,0);
  const mailbox=files.get('mailbox-1'),initial=JSON.parse(mailbox.text),result={version:'cbh-analysis/v2',suggestions:[{type:'memo',title:'자료 검토',body:'확인이 필요한 내용입니다.',sourceIds:['document-one']}]};
  const response={version:'cbh-chat-response/v1',requestId:created.id,sourceFingerprint:initial.sourceFingerprint,status:'ready',answer:'자료를 확인했습니다. 필요한 서류를 확인해 주세요.',result};
  mailbox.text=JSON.stringify(response);mailbox.meta.version='2';
  const received=await(await call('POST',{},[created.id,'read'],member,memberRepo)).json();
  check(received.status,'ready');check(received.answer,response.answer);assert.match(received.receiptId,/^analysis-receipt-/);count++;
  check(sql.prepare("SELECT COUNT(*) n FROM case_records WHERE kind<>'analysis_receipt'").get().n,0);
  check((await(await call('POST',{},[created.id,'read'],member,memberRepo)).json()).receiptId,received.receiptId);
  check(sql.prepare("SELECT COUNT(*) n FROM case_records WHERE kind='analysis_receipt'").get().n,1);
  const saved=await handleCase(new Request('https://local.invalid/api/private/case/analysis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...result,approved:true,receiptId:received.receiptId})}),{DB:db},member,['analysis']);
  check((await saved.json()).inserted,1);
  check((await repo.list()).length,1);
  expose=true;await expect('DRIVE_NOT_PRIVATE',()=>call('POST',{},[created.id,'read']));expose=false;
  mailbox.text=JSON.stringify({...response,requestId:'another-request'});await expect('CHAT_REPLY_INVALID',()=>call('POST',{},[created.id,'read']));mailbox.text=JSON.stringify(response);
  onExport=()=>{mailbox.meta.version='3';};await expect('CHAT_REPLY_CHANGED',()=>call('POST',{},[created.id,'read']));
  originalRevision='externally-changed';await expect('DRIVE_REVISION_CHANGED',()=>call('POST',{},[created.id,'read']));originalRevision='1';
  sql.prepare("UPDATE case_documents SET sha256=? WHERE id='document-one'").run('b'.repeat(64));
  await expect('ANALYSIS_SOURCES_CHANGED',()=>call('POST',{},[created.id,'read']));
  await expect('ANALYSIS_SOURCES_CHANGED',()=>handleCase(new Request('https://local.invalid/api/private/case/analysis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...result,approved:true,receiptId:received.receiptId})}),{DB:db},member,['analysis']));
  sql.prepare("UPDATE case_documents SET sha256=? WHERE id='document-one'").run('a'.repeat(64));
  failAfterCreate=true;await assert.rejects(()=>call('POST',{...body,requestId:'request-synthetic-02'}),/lost response/);count++;
  check(creations,2);await expect('CHAT_PREPARING',()=>call('POST',{...body,requestId:'request-synthetic-02'}));
  sql.exec("UPDATE case_chat_exchanges SET lease_until='' WHERE id='request-synthetic-02'");
  check((await(await call('POST',{},['request-synthetic-02','resume'])).json()).status,'waiting');check(creations,2);
  sql.exec("UPDATE case_consents SET admin_access=0");await expect('CASE_ACCESS_DENIED',()=>call('GET'));sql.exec("UPDATE case_consents SET admin_access=1");
  const sources={documents:[{id:'document-one',sha256:'a'.repeat(64),bytes:12}],notes:[]};
  check(readChatReply(JSON.stringify({...response,status:'waiting'}),created.id,initial.sourceFingerprint,sources),null);
  assert.throws(()=>readChatReply(JSON.stringify({...response,result:{...result,suggestions:[{...result.suggestions[0],sourceIds:['document-other']}]}}),created.id,initial.sourceFingerprint,sources));count++;
  assert.throws(()=>readChatReply(JSON.stringify({...response,answer:'x'.repeat(40001)}),created.id,initial.sourceFingerprint,sources));count++;
  check(sourceStamp({documents:[...sources.documents],notes:[]}),sourceStamp(sources));
  check(unwrapManualReply(result),{answer:'',value:result});
  check(unwrapManualReply(response),{answer:response.answer,value:result});
  check(unwrapManualReply({...response,result:null,approved:true,receiptId:'ignored'}),{answer:response.answer,value:null});
  assert.throws(()=>unwrapManualReply({...response,status:'waiting'}));count++;
  const largeNotes=[];
  for(let i=0;i<4;i++){
    const id='synthetic-large-note-'+i;
    sql.prepare('INSERT INTO case_records VALUES(?,?,?,?,?,?,?,NULL)').run(id,'case-synthetic','content',JSON.stringify({title:'Synthetic memo',body:'x'.repeat(60000),data:{},sourceIds:[],certainty:'reported'}),1,'user-member',current);
    largeNotes.push({id,revision:1});
  }
  const creationCount=creations;
  await expect('REQUEST_TOO_LARGE',()=>call('POST',{requestId:'request-too-large',documentIds:[],notes:largeNotes,question:''}));
  check(creations,creationCount);check(sql.prepare("SELECT COUNT(*) n FROM case_chat_exchanges WHERE id='request-too-large'").get().n,0);
  const {digest}=await vite.ssrLoadModule('/worker/modules/auth/crypto.ts');
  const {seal}=await vite.ssrLoadModule('/worker/modules/documents/drive.ts');
  const {handleProductRequest}=await vite.ssrLoadModule('/worker/modules/gateway.ts');
  const token='z'.repeat(43),tokenHash=await digest(token);
  sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?,?,?,?,?,?)').run(tokenHash,'user-admin',0,'synthetic-budget',0,current,new Date(Date.now()-360000).toISOString(),future,null);
  const env={DB:db,PRIVATE_WORK_ENABLED:'1',MUTATIONS_ENABLED:'1',PRIVATE_DRIVE_CLIENT_ID:'synthetic',PRIVATE_DRIVE_CLIENT_SECRET:'synthetic',PRIVATE_DRIVE_TOKEN_KEY:btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))};
  sql.prepare('INSERT INTO case_drive_connections VALUES(?,?,?,?,?,?,?)').run('case-synthetic',await seal('synthetic',env),'synthetic','private-root',JSON.stringify(['private-owner']),'user-member',current);
  const documentIds=['document-one'],bulkNotes=[];
  for(let i=0;i<19;i++){
    const id='document-bulk-'+i,fileId='original-bulk-'+i,bytes=30+i,sha=(i+1).toString(16).padStart(64,'0');
    sql.prepare('INSERT INTO case_documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'case-synthetic','synthetic.pdf','application/pdf',bytes,sha,fileId,'1','private-root','ready',null,'user-member',current,current);
    extraOriginals.set(fileId,{id:fileId,mimeType:'application/pdf',parents:['private-root'],size:String(bytes),sha256Checksum:sha,headRevisionId:'1',permissions:perms});documentIds.push(id);
  }
  for(let i=0;i<20;i++){
    const id='note-budget-'+i;
    sql.prepare('INSERT INTO case_records VALUES(?,?,?,?,?,?,?,NULL)').run(id,'case-synthetic','content',JSON.stringify({title:'Synthetic memo',body:'Synthetic text',data:{},sourceIds:[],certainty:'reported'}),1,'user-member',current);bulkNotes.push({id,revision:1});
  }
  const gatewayRequest=(suffix,body)=>new Request('https://local.invalid/api/private/case/documents/chat-exchanges'+suffix,{method:'POST',headers:{Origin:'https://local.invalid','Content-Type':'application/json',Cookie:'__Host-cbh-session='+token},body:JSON.stringify(body)});
  dbCalls=0;externalCalls=0;
  const budgetResponse=await handleProductRequest(gatewayRequest('',{requestId:'request-budget-20',documentIds,notes:bulkNotes,question:''}),env,null,fetcher);
  check(budgetResponse.status,201);
  const createBudget={d1:dbCalls,external:externalCalls,total:dbCalls+externalCalls};assert(createBudget.total<=50,JSON.stringify(createBudget));count++;
  const budgetBody=await budgetResponse.json(),budgetFile=files.get(new URL(budgetBody.url).pathname.split('/')[3]),budgetInitial=JSON.parse(budgetFile.text);
  budgetFile.text=JSON.stringify({...response,requestId:budgetBody.id,sourceFingerprint:budgetInitial.sourceFingerprint});budgetFile.meta.version='2';
  sql.prepare('UPDATE auth_sessions SET last_seen_at=? WHERE token_hash=?').run(new Date(Date.now()-360000).toISOString(),tokenHash);
  dbCalls=0;externalCalls=0;
  check((await handleProductRequest(gatewayRequest('/'+budgetBody.id+'/read',{}),env,null,fetcher)).status,200);
  const readBudget={d1:dbCalls,external:externalCalls,total:dbCalls+externalCalls};assert(readBudget.total<=50,JSON.stringify(readBudget));count++;
  console.log('Chat exchange full gateway,20originals+20notes,session refresh: '+JSON.stringify({createBudget,readBudget}));
  console.log(`ChatGPT private Drive exchange: ${count} checks PASS. Synthetic local SQLite and mocked Drive; no external calls.`);
}finally{sql.close();await vite.close();}
