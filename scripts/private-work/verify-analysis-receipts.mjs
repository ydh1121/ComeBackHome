import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdir, readFile } from 'node:fs/promises';
import { createServer } from 'vite';
const vite=await createServer({appType:'custom',logLevel:'error',server:{middlewareMode:true}});
const sql=new DatabaseSync(':memory:');
let beforeStatement=null;
const db={prepare(source){let args=[];return{bind(...values){args=values;return this},compile(){beforeStatement?.(source);const bound=[];const text=source.replace(/\?(\d+)/g,(_,n)=>{bound.push(args[Number(n)-1]);return'?'});return[sql.prepare(text),bound]},async all(){const[q,a]=this.compile();return{success:true,results:q.all(...a)}},async first(){return(await this.all()).results[0]??null},async run(){const[q,a]=this.compile();return /RETURNING/i.test(source)?{success:true,results:q.all(...a)}:{success:true,meta:q.run(...a)}}}},async batch(rows){sql.exec('BEGIN');try{const results=[];for(const row of rows)results.push(await row.run());sql.exec('COMMIT');return results}catch(e){sql.exec('ROLLBACK');throw e}}};
let checks=0;const check=(a,b,label)=>{assert.deepEqual(a,b,label);checks++};
try{
 for(const name of (await readdir('db/migrations')).filter(n=>n.endsWith('.sql')).sort())sql.exec(await readFile('db/migrations/'+name,'utf8'));
 const{digest}=await vite.ssrLoadModule('/worker/modules/auth/crypto.ts');
 const{handleProductRequest}=await vite.ssrLoadModule('/worker/modules/gateway.ts');
 const{handleAnalysisReceipts,receiveAnalysis}=await vite.ssrLoadModule('/worker/modules/injury/analysis-receipts.ts');
 const{CaseRepository}=await vite.ssrLoadModule('/worker/modules/injury/repository.ts');
 const origin='https://local.invalid',now=new Date().toISOString(),future=new Date(Date.now()+86400000).toISOString();
 const env={DB:db,PRIVATE_WORK_ENABLED:'1',MUTATIONS_ENABLED:'1'};
 const memberToken='m'.repeat(43),adminToken='a'.repeat(43),sessionHash=await digest(memberToken),adminHash=await digest(adminToken);
 sql.prepare('INSERT INTO auth_users VALUES(?,?,?,0,0,0,?)').run('member-synthetic','yvonne','member',now);
 sql.prepare('INSERT INTO auth_users VALUES(?,?,?,0,0,0,?)').run('admin-synthetic','ydh1121','admin',now);
 for(const[id,hash]of[['member-synthetic',sessionHash],['admin-synthetic',adminHash]])sql.prepare('INSERT INTO auth_sessions VALUES(?,?,0,?,1,?,?,?,NULL)').run(hash,id,'Synthetic',now,now,future);
 sql.prepare('INSERT INTO case_profiles VALUES(?,?,?)').run('case-synthetic','member-synthetic',now);
 sql.prepare('INSERT INTO case_consents VALUES(?,1,?,?,1,?,?)').run('case-synthetic','Synthetic consent','Synthetic retention','member-synthetic',now);
 sql.prepare("INSERT INTO case_documents(id,case_id,filename,mime,bytes,sha256,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,'ready',?,?,?)").run('document-synthetic','case-synthetic','synthetic.pdf','application/pdf',16,'a'.repeat(64),'member-synthetic',now,now);
 const note={title:'Synthetic note',body:'Synthetic source content',certainty:'reported',sourceIds:[],data:{category:'reference',medium:'none'}};
 sql.prepare('INSERT INTO case_records VALUES(?,?,?,?,1,?,?,NULL)').run('note-synthetic','case-synthetic','content',JSON.stringify(note),'member-synthetic',now);
 const p={id:'member-synthetic',loginId:'yvonne',role:'member',mustChangePassword:false,sessionHash,authEpoch:0};
 const repo=new CaseRepository(db,p,'case-synthetic');
 const request=(path,method='GET',body,headers={})=>new Request(origin+'/api/'+path,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
 const auth=(path,method='GET',body,token=memberToken)=>handleProductRequest(request(path,method,body,{Origin:origin,Cookie:'__Host-cbh-session='+token}),env);
 const source={documentIds:['document-synthetic'],notes:[{id:'note-synthetic',revision:1}]};
 const issue=async()=>{const response=await handleAnalysisReceipts(request('private/case/analysis-receipts','POST',source),env,p,repo,[]);check(response.status,201,'receipt created');return response.json()};
 const result={version:'cbh-analysis/v1',suggestions:[{type:'memo',title:'Synthetic returned summary',body:'Draft only',sourceIds:['document-synthetic']}]};
 const send=(receipt,body=result,headers={})=>handleProductRequest(request('private/analysis-return/'+receipt.id,'POST',body,{Authorization:'Bearer '+receipt.token,...headers}),env);
 check((await handleProductRequest(request('private/case/analysis-receipts','POST',source,{Origin:origin}),env)).status,401,'anonymous cannot create');
 const first=await issue();check(first.token.length,43,'256-bit token');check(Date.parse(first.expiresAt)-Date.now()<=3600000,true,'expiry bounded');
 const stored=sql.prepare('SELECT payload_json FROM case_records WHERE id=?').get(first.id).payload_json;
 check(stored.includes(first.token),false,'plaintext capability never stored');
 check((await send({...first,token:'x'.repeat(43)})).status,401,'wrong token');
 check((await send(first,result,{Origin:'https://attacker.invalid'})).status,403,'cross-site blocked');
 check((await handleProductRequest(request('private/analysis-return/'+first.id,'POST',result,{Origin:origin,Cookie:'__Host-cbh-session='+memberToken}),env)).status,401,'cookie alone cannot submit callback');
 check((await send(first,{...result,suggestions:[{...result.suggestions[0],sourceIds:['foreign-document']}]})).status,400,'foreign source blocked');
 check((await send(first,{...result,suggestions:[{...result.suggestions[0],certainty:'official'}]})).status,400,'official injection blocked');
 const countBefore=sql.prepare("SELECT COUNT(*) n FROM case_records WHERE kind<>'analysis_receipt'").get().n;
 check((await send(first)).status,202,'valid return staged');
 check(sql.prepare("SELECT COUNT(*) n FROM case_records WHERE kind<>'analysis_receipt'").get().n,countBefore,'no business records saved by return');
 check(sql.prepare('SELECT COUNT(*) n FROM case_payment_events').get().n,0,'no ledger write');
 const duplicate=await send(first);check(duplicate.status,202,'identical retry accepted');check((await duplicate.json()).duplicate,true,'identical retry distinguished');
 check((await send(first,{...result,suggestions:[{...result.suggestions[0],body:'Different result'}]})).status,409,'reuse different payload blocked');
 const get=await handleAnalysisReceipts(request('private/case/analysis-receipts/'+first.id),env,p,repo,[first.id]);const detail=await get.json();check(detail.result,result,'logged-in owner can review');check(detail.stale,false,'current source');
 for(const hidden of ['token','tokenHash','sessionHash','authEpoch','creatorId'])check(Object.hasOwn(detail,hidden),false,'no internal '+hidden);
 const listed=await(await handleAnalysisReceipts(request('private/case/analysis-receipts'),env,p,repo,[])).json();check(JSON.stringify(listed).includes('tokenHash'),false,'inbox sanitized');
 const updated=sql.prepare('SELECT revision FROM case_records WHERE id=?').get(first.id).revision;check(updated,2,'duplicate no new history');
 // Every general API surface must exclude the reserved server envelope.
 const publicList=await auth('private/case');check(publicList.status,200,'authenticated case read');const publicData=await publicList.json();check(publicData.records.some(r=>r.id===first.id),false,'internal record excluded');
 const exported=await(await auth('private/case/export')).json();check(JSON.stringify(exported).includes('tokenHash'),false,'export strips envelope and revisions');
 for(const [suffix,method,body]of[['','GET'],['/history','GET'],['','PUT',{kind:'content',payload:note,revision:2}],['/archive','POST',{revision:2}],['/restore','POST',{revision:2}]])check((await auth('private/case/records/'+first.id+suffix,method,body)).status,404,'reserved general route blocked '+suffix+method);
 const adminRead=await auth('private/case/analysis-receipts/'+first.id,'GET',undefined,adminToken);check(adminRead.status,404,'other authorized account cannot read capability inbox');
 check((await auth('private/case/analysis','POST',{...result,approved:true,receiptId:first.id,suggestions:[{...result.suggestions[0],body:'Substituted outside staged result'}]})).status,400,'receipt cannot authorize substituted proposal');
 check((await auth('private/case/analysis','POST',{...result,approved:false,receiptId:first.id})).status,400,'receipt still needs explicit approval');
 const applied=await auth('private/case/analysis','POST',{...result,approved:true,receiptId:first.id});check(applied.status,200,'explicit selected receipt apply');check((await applied.json()).inserted,1,'business record only on explicit apply');
 check((await(await auth('private/case/analysis','POST',{...result,approved:true,receiptId:first.id})).json()).inserted,0,'replayed apply duplicate-safe');

 const linkedReceipt=await issue();
 const parent={type:'record',kind:'employment',ref:'job',title:'Synthetic receipt job',body:'Synthetic employment draft',sourceIds:['document-synthetic'],data:{employerName:'Synthetic employer',employmentType:'regular',actualOrSimulated:'actual',hireDate:'2026-01-01',wageType:'monthly'}};
 const child={type:'record',kind:'paid_day',ref:'day',title:'Synthetic receipt day',body:'Synthetic day draft',sourceIds:['document-synthetic'],data:{date:'2026-01-15',dayType:'paid_work',verification:'estimated',employmentId:'@job'}};
 const linked={version:'cbh-analysis/v2',suggestions:[child,parent]};
 check((await send(linkedReceipt,{...linked,suggestions:[child]})).status,400,'missing proposal reference rejected');
 check((await send(linkedReceipt,{...linked,suggestions:[{...child,data:{...child.data,employmentId:'@missing'}},parent]})).status,400,'unknown proposal reference rejected');
 check((await send(linkedReceipt,{...linked,suggestions:[child,{type:'memo',ref:'job',title:'Synthetic wrong reference type',body:'Synthetic',sourceIds:[]}]})).status,400,'wrong proposal reference kind rejected');
 check((await send(linkedReceipt,{...linked,suggestions:[{...child,data:{...child.data,employmentId:'ungranted-existing-record'}},parent]})).status,400,'existing record outside receipt scope rejected');
 check((await send(linkedReceipt,linked)).status,202,'valid linked proposals staged');
 const linkedApply=await auth('private/case/analysis','POST',{...linked,approved:true,receiptId:linkedReceipt.id});check(linkedApply.status,200,'linked receipt applied after explicit approval');check((await linkedApply.json()).inserted,2,'linked parent and child both created');
 const created=sql.prepare("SELECT id,payload_json FROM case_records WHERE kind='paid_day'").all().map(r=>({id:r.id,payload:JSON.parse(r.payload_json)})).find(r=>r.payload.title===child.title);
 check(!!created,true,'linked child exists');check(created.payload.data.employmentId.startsWith('import-'),true,'temporary ref resolved to stable saved ID');
 check(JSON.parse(sql.prepare('SELECT payload_json FROM case_records WHERE id=?').get(created.payload.data.employmentId).payload_json).title,parent.title,'child linked to correct saved parent');
 check((await(await auth('private/case/analysis','POST',{...linked,approved:true,receiptId:linkedReceipt.id})).json()).inserted,0,'linked receipt replay creates no duplicates');

 sql.prepare('UPDATE case_records SET revision=revision+1,updated_at=? WHERE id=?').run(new Date(Date.now()+1).toISOString(),'note-synthetic');
 const stale=await(await handleAnalysisReceipts(request('private/case/analysis-receipts/'+first.id),env,p,repo,[first.id])).json();check(stale.stale,true,'note revision stales result');check(stale.result,null,'stale result not offered as current');
 check((await send(first)).status,409,'stale source callback blocked');
 check((await auth('private/case/analysis','POST',{...result,approved:true,receiptId:first.id})).status,409,'stale receipt cannot apply');
 source.notes[0].revision=2;
 const revoked=await issue();check((await handleAnalysisReceipts(request('private/case/analysis-receipts/'+revoked.id+'/revoke','POST',{}),env,p,repo,[revoked.id,'revoke'])).status,200,'explicit revoke');check((await send(revoked)).status,410,'revoked token');
 const expired=await issue();sql.prepare("UPDATE case_records SET payload_json=json_set(payload_json,'$.expiresAt',?),revision=revision+1 WHERE id=?").run('2000-01-01T00:00:00.000Z',expired.id);check((await send(expired)).status,410,'expired token');
 const logout=await issue();sql.prepare('UPDATE auth_sessions SET revoked_at=? WHERE token_hash=?').run(now,sessionHash);check((await send(logout)).status,403,'logout revokes callback');sql.prepare('UPDATE auth_sessions SET revoked_at=NULL WHERE token_hash=?').run(sessionHash);
 const disabled=await issue();sql.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(p.id);check((await send(disabled)).status,401,'disabled user');sql.prepare('UPDATE auth_users SET disabled=0 WHERE id=?').run(p.id);
 const epoch=await issue();sql.prepare('UPDATE auth_users SET auth_epoch=1 WHERE id=?').run(p.id);check((await send(epoch)).status,401,'password epoch revokes');sql.prepare('UPDATE auth_users SET auth_epoch=0 WHERE id=?').run(p.id);
 // One SQL record update includes history and audit. Forced audit failure rolls all back.
 await handleAnalysisReceipts(request('private/case/analysis-receipts/'+logout.id+'/revoke','POST',{}),env,p,repo,[logout.id,'revoke']);
 const rollback=await issue();sql.exec("CREATE TRIGGER synthetic_fail_receipt BEFORE INSERT ON case_audit WHEN NEW.target_id='"+rollback.id+"' AND NEW.action='record-revision' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_AUDIT_FAILURE'); END;");
 check((await send(rollback)).status,503,'audit failure rejects receipt');check(JSON.parse(sql.prepare('SELECT payload_json FROM case_records WHERE id=?').get(rollback.id).payload_json).status,'waiting','failed receipt transaction preserved');sql.exec('DROP TRIGGER synthetic_fail_receipt');check((await send(rollback)).status,202,'retry after rollback');
 check((await handleProductRequest(request('private/analysis-return/'+rollback.id,'POST',result,{Authorization:'Bearer '+rollback.token}),{...env,MUTATIONS_ENABLED:'0'})).status,503,'write gate respected');
 // Full 20-document / 40-note grants use a bounded number of D1 calls.
 const large={documentIds:[],notes:[]};
 for(let i=0;i<20;i++){const id='synthetic-bulk-document-'+i;sql.prepare("INSERT INTO case_documents(id,case_id,filename,mime,bytes,sha256,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,'ready',?,?,?)").run(id,'case-synthetic','synthetic-bulk-'+i+'.pdf','application/pdf',i+32,String(i).padStart(64,'0'),'member-synthetic',now,now);large.documentIds.push(id)}
 for(let i=0;i<40;i++){const id='synthetic-bulk-note-'+i;sql.prepare('INSERT INTO case_records VALUES(?,?,?,?,1,?,?,NULL)').run(id,'case-synthetic','content',JSON.stringify(note),'member-synthetic',now);large.notes.push({id,revision:1})}
 let queries=0;beforeStatement=()=>queries++;
 const bigResponse=await handleAnalysisReceipts(request('private/case/analysis-receipts','POST',large),env,p,repo,[]);check(bigResponse.status,201,'max source grant');const big=await bigResponse.json();check(queries<=5,true,'max grant creation within Free D1 budget');
 queries=0;check((await send(big,{...result,suggestions:[{...result.suggestions[0],sourceIds:large.documentIds}]})).status,202,'max source callback');check(queries<=8,true,'max source callback within Free D1 budget');beforeStatement=null;
 // A source modified after preflight cannot slip into receipt storage.
 const raced=await issue();
 beforeStatement=(statement)=>{if(statement.startsWith('UPDATE case_records SET payload_json=')){beforeStatement=null;sql.prepare('UPDATE case_records SET revision=revision+1,updated_at=? WHERE id=?').run(new Date(Date.now()+2).toISOString(),'note-synthetic')}};
 check((await send(raced)).status,409,'source-change race blocked inside write');beforeStatement=null;
 check(JSON.parse(sql.prepare('SELECT payload_json FROM case_records WHERE id=?').get(raced.id).payload_json).status,'waiting','source race does not stage stale content');
 // An administrator capability is revoked by the member consent boundary.
 const adminPrincipal={...p,id:'admin-synthetic',loginId:'ydh1121',role:'admin',sessionHash:adminHash};const adminRepo=new CaseRepository(db,adminPrincipal,'case-synthetic');
 const adminReceipt=await(await handleAnalysisReceipts(request('private/case/analysis-receipts','POST',{documentIds:['document-synthetic'],notes:[]}),env,adminPrincipal,adminRepo,[])).json();
 sql.prepare('UPDATE case_consents SET admin_access=0,revision=revision+1 WHERE case_id=?').run('case-synthetic');check((await send(adminReceipt)).status,403,'consent revocation stops external submission');
 console.log('PRIVATE_ANALYSIS_RECEIPTS_PASS checks='+checks+' scoped_bearer_staging_only_no_auto_apply_sources_revocation_replay_history_hidden');
}finally{sql.close();await vite.close()}
