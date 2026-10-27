// Synthetic local SQL and in-memory Drive only. No external service is called.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
const vite=await createServer({appType:'custom',logLevel:'error',server:{middlewareMode:true}});
const load=p=>vite.ssrLoadModule('/'+p);
const sql=new DatabaseSync(':memory:');
let beforeStatement=null;
const db={prepare(source){let values=[];return {bind(...args){values=args;return this;},compile(){beforeStatement?.(source);const params=[];const text=source.replace(/\?(\d+)/g,(_,n)=>{params.push(values[Number(n)-1]);return '?';});return [sql.prepare(text),params];},async all(){const [q,a]=this.compile();return {success:true,results:q.all(...a)};},async first(){return (await this.all()).results[0]??null;},async run(){const [q,a]=this.compile();return /RETURNING/i.test(source)?{success:true,results:q.all(...a)}:{success:true,meta:q.run(...a)};}};},async batch(statements){sql.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
let checks=0;
function check(a,b,message){assert.deepEqual(a,b,message);checks++;}
try {
  sql.exec(await readFile('db/migrations/0012_private_work_modules.sql','utf8'));
  const time=new Date().toISOString();
  sql.prepare('INSERT INTO auth_users VALUES(?,?,?,0,0,0,?)').run('member-fixture','yvonne','member',time);
  sql.prepare('INSERT INTO case_profiles VALUES(?,?,?)').run('case-fixture','member-fixture',time);
  sql.prepare('INSERT INTO auth_sessions VALUES(?,?,0,?,1,?,?,?,NULL)').run('synthetic-session','member-fixture','synthetic browser',time,time,new Date(Date.now()+3600000).toISOString());
  const {CaseRepository}=await load('worker/modules/injury/repository.ts');
  const {DriveArchive,seal}=await load('worker/modules/documents/drive.ts');
  const {digest,encode64}=await load('worker/modules/auth/crypto.ts');
  const {organizeDocuments}=await load('worker/modules/documents/organization.ts');
  const {handleDocuments}=await load('worker/modules/documents/service.ts');
  const {validateOrganization}=await load('src/modules/injury/materials/organization.ts');
  const {createDriveFixture}=await load('worker/testing/private-work-local.ts');
  const fixture=createDriveFixture();
  const env={DB:db,PRIVATE_DRIVE_TOKEN_KEY:encode64(crypto.getRandomValues(new Uint8Array(32))),PRIVATE_DRIVE_CLIENT_ID:'synthetic',PRIVATE_DRIVE_CLIENT_SECRET:'synthetic'};
  const principal={id:'member-fixture',authEpoch:0,sessionHash:'synthetic-session',role:'member',loginId:'yvonne'};
  const repo=new CaseRepository(db,principal,'case-fixture');
  const connection={folder_id:'synthetic-folder',permission_ids_json:'["synthetic-owner"]',google_subject:'synthetic-subject',refresh_token_encrypted:await seal('synthetic-refresh',env)};
  sql.prepare('INSERT INTO case_drive_connections VALUES(?,?,?,?,?,?,?)').run('case-fixture',connection.refresh_token_encrypted,connection.google_subject,connection.folder_id,connection.permission_ids_json,principal.id,time);
  let requestCalls=0,maxRequestCalls=0;
  const api=new DriveArchive('synthetic',async(...args)=>{requestCalls++;return fixture.fetcher(...args);});
  async function add(id){
    const content=new TextEncoder().encode('%PDF-synthetic-private-'+id), sha=await digest(content.buffer), driveId=await api.generateId();
    const session=await api.begin({id:driveId,name:'Synthetic.pdf',mime:'application/pdf',bytes:content.length,folder:connection.folder_id});
    await api.chunk(session,content.buffer,0,content.length,'application/pdf');
    sql.prepare("INSERT INTO case_documents VALUES(?,?,?,?,?,?,?,?,?,'ready',NULL,?,?,?)").run(id,'case-fixture','Synthetic.pdf','application/pdf',content.length,sha,driveId,'synthetic-revision','synthetic-folder',principal.id,time,time);
    return driveId;
  }
  const docA='synthetic-doc-a',docB='synthetic-doc-b';
  const driveA=await add(docA),driveB=await add(docB);
  const propose=(documentId,category='medical')=>({documentId,category});
  const run=async proposals=>{requestCalls=0;const result=await organizeDocuments({approved:true,proposals},env,repo,connection,api);maxRequestCalls=Math.max(maxRequestCalls,requestCalls+1);return result;};
  await assert.rejects(()=>organizeDocuments({proposals:[propose(docA)]},env,repo,connection,api),e=>e.code==='APPROVAL_REQUIRED');checks++;
  for(const value of [[],[propose(docA,'arbitrary-folder')],[propose(docA),propose(docA)],[{...propose(docA),folderId:'foreign-root'}]]){assert.throws(()=>validateOrganization(value));checks++;}
  check(fixture.moves(),0,'no remote move before approval');
  await assert.rejects(()=>run([propose(docA),propose(docB)]),e=>e.code==='ORGANIZATION_ONE_FILE_PER_REQUEST');checks++;
  check((await run([propose('unknown-document')])).results[0].status,'failed','unknown/foreign documents are rejected');
  check(fixture.moves(),0,'unknown document never mutates Drive');
  fixture.share(true);
  check((await run([propose(docA)])).results[0].error,'PRIVATE_FOLDER_REQUIRED','shared root blocked');
  fixture.share(false);
  fixture.changeRevision('modified-content');
  check((await run([propose(docA)])).results[0].error,'DRIVE_REVISION_CHANGED','changed revision blocked');
  fixture.changeRevision('synthetic-revision');
  check(fixture.moves(),0,'rejected prechecks never move');
  const noEtagApi=new DriveArchive('synthetic',async(...args)=>{const response=await fixture.fetcher(...args);const headers=new Headers(response.headers);headers.delete('ETag');if(response.ok&&headers.get('Content-Type')?.includes('application/json')){const value=await response.json();delete value.etag;return Response.json(value,{headers});}return new Response(response.body,{status:response.status,headers});});
  check((await organizeDocuments({approved:true,proposals:[propose(docA)]},env,repo,connection,noEtagApi)).results[0].error,'DRIVE_CONCURRENT_CHECK_UNAVAILABLE','missing ETag cannot downgrade to unconditional PATCH');
  check(fixture.moves(),0,'missing ETag performs zero moves');
  check(sql.prepare('SELECT session_encrypted FROM case_documents WHERE id=?').get(docA).session_encrypted,null,'missing ETag does not lock a document');
  fixture.loseNextMoveResponse();
  check((await run([propose(docA)])).results[0].status,'failed','lost remote response is not false success');
  check(fixture.moves(),1,'remote movement happened once');
  let row=sql.prepare('SELECT * FROM case_documents WHERE id=?').get(docA);
  check(row.folder_id,'synthetic-folder','DB location retained before verification');
  check(!!row.session_encrypted,true,'pending encrypted journal retained');
  const action=kind=>handleDocuments(new Request('https://local.invalid/api/private/case/documents/'+docA+'/'+kind,{method:['handoff','organization'].includes(kind)?'GET':'POST'}),env,principal,repo,true,[docA,kind],fixture.fetcher);
  check(await (await action('organization')).json(),{pending:true,category:'medical'},'reload exposes only safe pending category for resume');
  await assert.rejects(()=>action('archive'),e=>e.code==='DRIVE_ORGANIZATION_PENDING');checks++;
  await assert.rejects(()=>action('verify'),e=>e.code==='DRIVE_ORGANIZATION_PENDING');checks++;
  await assert.rejects(()=>action('handoff'),e=>e.code==='DRIVE_ORGANIZATION_PENDING');checks++;
  check((await run([propose(docA,'employment')])).results[0].error,'DRIVE_ORGANIZATION_PENDING','pending target cannot silently change');
  check((await run([propose(docA)])).results[0].status,'organized','retry reconciles target and DB');
  check(fixture.moves(),1,'lost-response retry does not repeat move');
  row=sql.prepare('SELECT * FROM case_documents WHERE id=?').get(docA);
  check(row.folder_id,fixture.parents(driveA)[0],'DB points to verified new parent');
  check(row.session_encrypted,null,'journal cleared only after verification');
  check(await (await action('organization')).json(),{pending:false},'completed state no longer reports pending');
  check(row.drive_file_id,driveA,'original Drive ID unchanged');
  check((await action('handoff')).status,200,'handoff remains available after organization');
  check((await run([propose(docA)])).results[0].status,'organized','same-category replay succeeds');
  check(fixture.moves(),1,'same-category replay never re-moves');
  beforeStatement=source=>{if(source.startsWith('INSERT INTO case_audit SELECT')&&source.includes("'document-organize'")){beforeStatement=null;throw Error('synthetic commit error');}};
  check((await run([propose(docB)])).results[0].status,'failed','SQL audit failure reports pending');
  check(sql.prepare('SELECT folder_id FROM case_documents WHERE id=?').get(docB).folder_id,'synthetic-folder','SQL location rollback atomic with audit');
  check(!!sql.prepare('SELECT session_encrypted FROM case_documents WHERE id=?').get(docB).session_encrypted,true,'SQL rollback retains journal');
  const moveCount=fixture.moves();
  check((await run([propose(docB)])).results[0].status,'organized','SQL failure retry reconciles');
  check(fixture.moves(),moveCount,'SQL failure retry never repeats remote move');
  check(fixture.parents(driveA),fixture.parents(driveB),'same category uses one reserved folder');
  check(sql.prepare("SELECT count(*) n FROM case_audit WHERE action='drive-category-medical'").get().n,1,'one durable category reservation');
  check((await run([propose(docA,'employment')])).results[0].status,'organized','explicit recategorization from app folder allowed');
  const originalParent=fixture.parents(driveA);
  fixture.changeParents(driveA,['foreign-root']);
  check((await run([propose(docA,'medical')])).results[0].status,'failed','externally relocated original rejected');
  fixture.changeParents(driveA,originalParent);
  // Modify content revision after checked metadata and before PATCH: ETag must
  // stop the write; retry also sees original revision mismatch.
  const raceApi=new DriveArchive('synthetic',async(input,init)=>{if(init?.method==='PATCH')fixture.changeRevision('concurrent-change');return fixture.fetcher(input,init);});
  const beforeRace=fixture.moves();
  check((await organizeDocuments({approved:true,proposals:[propose(docA,'other')]},env,repo,connection,raceApi)).results[0].status,'failed','concurrent content change blocks conditional move');
  check(fixture.moves(),beforeRace,'ETag prevents race mutation');
  fixture.changeRevision('synthetic-revision');
  check((await run([propose(docA,'other')])).results[0].status,'organized','unchanged original can resume pending operation');
  // Even metadata without sha256Checksum stays below the Free request budget.
  const docC='synthetic-doc-c';await add(docC);let fallbackCalls=0;
  const fallbackApi=new DriveArchive('synthetic',async(...args)=>{
    fallbackCalls++;const response=await fixture.fetcher(...args);
    if(response.ok && response.headers.get('Content-Type')?.includes('application/json')){
      const value=await response.clone().json();
      if(value.sha256Checksum){delete value.sha256Checksum;return Response.json(value,{headers:response.headers});}
    }
    return response;
  });
  check((await organizeDocuments({approved:true,proposals:[propose(docC,'correspondence')]},env,repo,connection,fallbackApi)).results[0].status,'organized','checksum download fallback verified');
  check(Math.max(maxRequestCalls,fallbackCalls+1)<50,true,'including token refresh each operation stays below50 external subrequests');
  const docD='synthetic-doc-d';await add(docD);let v2Calls=0,v2Patches=0;
  const v2Api=new DriveArchive('synthetic',async(...args)=>{
    v2Calls++;if(String(args[0]).includes('/drive/v2/')&&args[1]?.method==='PATCH')v2Patches++;
    const response=await fixture.fetcher(...args),headers=new Headers(response.headers);headers.delete('ETag');
    if(response.ok&&headers.get('Content-Type')?.includes('application/json')){const value=await response.json();delete value.sha256Checksum;return Response.json(value,{headers});}
    return new Response(response.body,{status:response.status,headers});
  });
  check((await organizeDocuments({approved:true,proposals:[propose(docD,'application')]},env,repo,connection,v2Api)).results[0].status,'organized','v2 conditional fallback supports missing v3 ETag');
  check(v2Patches,1,'fallback uses one v2 PATCH with If-Match');
  check(v2Calls+1<50,true,'v2 fallback stays within Free request budget');
  const docE='synthetic-doc-e';await add(docE);let racePatches=0;
  const v2RaceApi=new DriveArchive('synthetic',async(...args)=>{
    if(String(args[0]).includes('/drive/v2/')&&args[1]?.method!=='PATCH')fixture.changeMetadataVersion();
    if(args[1]?.method==='PATCH')racePatches++;
    const response=await fixture.fetcher(...args),headers=new Headers(response.headers);headers.delete('ETag');
    return new Response(response.body,{status:response.status,headers});
  });
  check((await organizeDocuments({approved:true,proposals:[propose(docE,'medical')]},env,repo,connection,v2RaceApi)).results[0].error,'DRIVE_REVISION_CHANGED','v2 fallback rejects changed metadata version even with same binary revision');
  check(racePatches,0,'cross-version mismatch never PATCHes');
  check(sql.prepare('SELECT session_encrypted FROM case_documents WHERE id=?').get(docE).session_encrypted,null,'cross-version mismatch does not lock source');
  // Received analysis can move only its exact reviewed proposal while the
  // bound document/note snapshots and creator session remain current.
  const receipt='analysis-receipt-synthetic-organize',note='synthetic-review-note';
  const payload={title:'Synthetic memo',body:'Synthetic only',certainty:'reported',sourceIds:[],data:{category:'reference',medium:'none'}};
  sql.prepare("INSERT INTO case_records VALUES(?,?,'content',?,1,?,?,NULL)").run(note,'case-fixture',JSON.stringify(payload),principal.id,time);
  const source=sql.prepare('SELECT sha256,bytes FROM case_documents WHERE id=?').get(docC);
  const envelope={version:'cbh-analysis-receipt/v1',creatorId:principal.id,sessionHash:principal.sessionHash,authEpoch:0,status:'received',documents:[{id:docC,...source}],notes:[{id:note,revision:1}],result:{version:'cbh-analysis/v2',suggestions:[],documentMoves:[propose(docC,'payments')]}};
  sql.prepare("INSERT INTO case_records VALUES(?,?,'analysis_receipt',?,1,?,?,NULL)").run(receipt,'case-fixture',JSON.stringify(envelope),principal.id,time);
  const received=proposals=>organizeDocuments({approved:true,receiptId:receipt,proposals},env,repo,connection,api);
  await assert.rejects(()=>received([propose(docB,'payments')]),e=>e.code==='ANALYSIS_SOURCE_NOT_ALLOWED');checks++;
  await assert.rejects(()=>received([propose(docC,'medical')]),e=>e.code==='ANALYSIS_SOURCE_NOT_ALLOWED');checks++;
  sql.prepare('UPDATE case_records SET revision=2,updated_at=? WHERE id=?').run(new Date(Date.now()+1000).toISOString(),note);
  await assert.rejects(()=>received([propose(docC,'payments')]),e=>e.code==='ANALYSIS_SOURCES_CHANGED');checks++;
  const beforeRevoke=fixture.moves();
  sql.prepare("UPDATE auth_sessions SET revoked_at=? WHERE token_hash='synthetic-session'").run(time);
  await assert.rejects(()=>run([propose(docB,'other')]),e=>e.code==='CASE_ACCESS_DENIED');checks++;
  check(fixture.moves(),beforeRevoke,'revoked session never moves');
  check(sql.prepare('SELECT count(*) n FROM case_records').get().n,2,'organization does not invent business records');
  check(sql.prepare('SELECT count(*) n FROM case_payment_events').get().n,0,'organization writes no ledger');
  console.log('PRIVATE_ORGANIZATION_PASS '+checks+' checks; maximum external calls including refresh '+Math.max(maxRequestCalls,fallbackCalls+1,v2Calls+1));
} finally {sql.close();await vite.close();}
