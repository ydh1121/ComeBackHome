// Isolated Wrangler HTTP/D1 sidecar for the existing weekly Paddle browser suite.
// NEVER use --remote, production credentials, Cloudflare deploys or user images.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer as createTcpServer} from 'node:net';

const root=fileURLToPath(new URL('../',import.meta.url));
const config=resolve(root,'wrangler.local.jsonc');
const wrangler=resolve(root,'node_modules/.bin/',process.platform==='win32'?'wrangler.cmd':'wrangler');
const run=promisify(execFile);
const nap=ms=>new Promise(ok=>setTimeout(ok,ms));
async function freePort(){
  const listener=createTcpServer();
  await new Promise((ok,no)=>listener.once('error',no).listen(0,'127.0.0.1',ok));
  const port=listener.address().port;
  await new Promise(ok=>listener.close(ok));
  return port;
}
export async function startWeeklyRealHttpD1(){
  await access(wrangler);
  const tmp=await mkdtemp(join(tmpdir(),'cbh-weekly-real-http-d1-'));
  let processHandle=null,output='',origin=null;
  const stats={proxiedApi:0,postPeople:0,atomicImports:0,remoteWrites:0,liveKakaoCalls:0};
  const close=async()=>{
    if(processHandle&&processHandle.exitCode==null){
      processHandle.kill();
      await Promise.race([
        new Promise(ok=>processHandle.once('exit',ok)),
        nap(2500).then(()=>{if(processHandle.exitCode==null)processHandle.kill('SIGKILL');}),
      ]);
    }
    await rm(tmp,{recursive:true,force:true});
  };
  const json=async(path,init={})=>{
    const res=await fetch(origin+path,{...init,redirect:'error',signal:AbortSignal.timeout(15000)});
    return {status:res.status,ok:res.ok,body:await res.json().catch(()=>null)};
  };
  try{
    console.info('CBH_REAL_HTTP_D1_TRACE: APPLY_LOCAL_MIGRATIONS');
    await run(wrangler,['d1','migrations','apply','come-back-home-db','--local',
      '--config',config,'--persist-to',tmp],{
        cwd:root,env:{...process.env,CI:'true'},maxBuffer:5*1024*1024,
      });
    console.info('CBH_REAL_HTTP_D1_TRACE: LOCAL_MIGRATIONS_COMPLETE');
    const port=await freePort();
    origin='http://127.0.0.1:'+port;
    processHandle=spawn(wrangler,[
      'dev','--local','--config',config,'--persist-to',tmp,
      '--ip','127.0.0.1','--port',String(port),
      '--show-interactive-dev-session=false','--log-level','warn',
    ],{cwd:root,env:{...process.env,CI:'true'},stdio:['ignore','pipe','pipe'],shell:false});
    processHandle.stdout.on('data',v=>{output+=v.toString();output=output.slice(-10000)});
    processHandle.stderr.on('data',v=>{output+=v.toString();output=output.slice(-10000)});
    console.info('CBH_REAL_HTTP_D1_TRACE: STARTED_LOOPBACK_WORKER');
    let ready=false,lastHealthError=null;
    const deadline=Date.now()+45_000;
    while(Date.now()<deadline){
      if(processHandle.exitCode!==null)
        throw Error('Local Wrangler exited: '+output);
      try{
        const health=await fetch(origin+'/api/health',{
          signal:AbortSignal.timeout(2000),redirect:'error',
        });
        const payload=await health.json().catch(()=>null);
        if(health.ok&&payload?.ok===true){ready=true;break}
        lastHealthError=JSON.stringify({status:health.status,body:payload});
      }catch(error){lastHealthError=String(error)}
      await nap(250);
    }
    if(!ready)throw Error('Local Wrangler health failed after 45s: '+
      String(lastHealthError)+' '+output);
    console.info('CBH_REAL_HTTP_D1_TRACE: WORKER_HEALTH_PASS');
    const people=[];
    for(const name of ['강하현','정지윤']){
      const r=await json('/api/people',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name,relation:'synthetic-weekly-ocr-only'})});
      if(!r.ok||typeof r.body?.person?.id!=='string')
        throw Error('Unable to seed local D1 person '+name+': '+JSON.stringify(r));
      people.push(r.body.person);stats.postPeople++;
      console.info('CBH_REAL_HTTP_D1_TRACE: SEEDED_PERSON_'+stats.postPeople);
    }
    return{
      origin,people,stats,json,close,
      // Vite owns the only browser origin. Forward only same-origin /api/*
      // to a separate loopback Wrangler HTTP process backed by ephemeral D1.
      async proxy(request,response){
        stats.proxiedApi++;
        const path=new URL(request.url??'/','http://localhost').pathname;
        if(path==='/api/schedules/import'&&request.method==='PUT'){
          stats.atomicImports++;
          console.info('CBH_REAL_HTTP_D1_TRACE: HTTP_ATOMIC_REQUEST_'+stats.atomicImports);
        }
        try{
          const chunks=[];
          for await(const chunk of request)chunks.push(Buffer.from(chunk));
          const body=chunks.length?Buffer.concat(chunks):undefined;
          const upstream=await fetch(origin+(request.url??'/'),{
            method:request.method,
            headers:{'accept':'application/json',...(body?.length?{'content-type':request.headers['content-type']??'application/json'}:{})},
            ...(body?{body}:{}),redirect:'error',signal:AbortSignal.timeout(30000),
          });
          response.statusCode=upstream.status;
          response.setHeader('content-type',upstream.headers.get('content-type')??'application/json');
          response.setHeader('cache-control','no-store');
          response.end(Buffer.from(await upstream.arrayBuffer()));
        }catch(error){response.statusCode=502;response.setHeader('content-type','application/json');
          response.end(JSON.stringify({error:'LOCAL_HTTP_BRIDGE_FAILED',reason:String(error)}));}
      },
      async snapshot(){
        const result=[];
        for(const person of people){
          const r=await json('/api/people/'+encodeURIComponent(person.id)+'/schedules');
          if(!r.ok||!Array.isArray(r.body?.schedules))throw Error('Local D1 readback failed');
          for(const item of r.body.schedules)result.push({...item});
        }
        return result.sort((a,b)=>(a.personId+'|'+a.date).localeCompare(b.personId+'|'+b.date));
      },
      async atomicReviewedChecks(){
        const request=(input)=>json('/api/schedules/import',{
          method:'PUT',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({reviewedImport:input}),
        });
        const dates=(monday)=>Array.from({length:7},(_,i)=>
          new Date(Date.parse(monday+'T00:00:00Z')+86400000*i)
            .toISOString().slice(0,10));
        const newPerson=(name)=>({ref:crypto.randomUUID(),name});
        const make=(weekStart,newPeople,existingIds=[])=>{
          const requestId=crypto.randomUUID();
          const rows=[];
          for(const [index,person] of [...newPeople.map(p=>({pendingPersonRef:p.ref})),
            ...existingIds.map(id=>({personId:id}))].entries()){
            for(const [dayIndex,date] of dates(weekStart).entries())
              rows.push({...person,id:crypto.randomUUID(),date,dayIndex,
                enabled:dayIndex!==6,start:dayIndex===6?'00:00':'09:30',
                end:dayIndex===6?'00:00':'23:30',
                breakMinutes:dayIndex===6?null:30,decision:'NEW',approved:true,
                ...(dayIndex===6?{recognitionState:'OFF_CANDIDATE',offApproved:true}:{}),
              });
          }
          return {requestId,weekStart,confirmed:true,newPeople,schedules:rows};
        };
        const snapshot=async()=>{
          const peopleResponse=await json('/api/people');
          if(!peopleResponse.ok)throw Error('ATOMIC_TEST_PEOPLE_READ_FAILED');
          const people=peopleResponse.body.people;
          const schedules=[];
          for(const person of people){
            const r=await json('/api/people/'+encodeURIComponent(person.id)+'/schedules');
            if(!r.ok)throw Error('ATOMIC_TEST_SCHEDULE_READ_FAILED');
            schedules.push(...r.body.schedules);
          }
          people.sort((a,b)=>a.id.localeCompare(b.id));
          schedules.sort((a,b)=>(a.personId+'|'+a.date).localeCompare(b.personId+'|'+b.date));
          return {people,schedules};
        };
        const countStable=async(before,kind,change)=>{
          const failed=await request(change);
          if(failed.ok||failed.status!==400)throw Error('ATOMIC_'+kind+'_ACCEPTED');
          const after=await snapshot();
          if(JSON.stringify(after)!==JSON.stringify(before))
            throw Error('ATOMIC_'+kind+'_PARTIALLY_COMMITTED');
          return kind;
        };
        const outcomes=[];
        const start='2099-02-02';
        const first=make(start,[newPerson('홍테스트')]);
        const before=await snapshot();
        // Unapproved and invalid weekly inputs cannot change any table.
        outcomes.push(await countStable(before,'WEEK_NOT_CONFIRMED',{...first,confirmed:false}));
        outcomes.push(await countStable(before,'UNAPPROVED_CELL',{
          ...first,schedules:first.schedules.map((row,i)=>i?row:{...row,approved:false}),
        }));
        outcomes.push(await countStable(before,'OFF_CANDIDATE',{
          ...first,schedules:first.schedules.map((row,i)=>i===6?{...row,offApproved:false}:row),
        }));
        outcomes.push(await countStable(before,'INVALID_CLOCK',{
          ...first,schedules:first.schedules.map((row,i)=>i===2?{...row,start:'99:99'}:row),
        }));
        outcomes.push(await countStable(before,'INVALID_BREAK',{
          ...first,schedules:first.schedules.map((row,i)=>i===3?{...row,breakMinutes:900}:row),
        }));
        outcomes.push(await countStable(before,'MISSING_OWNER',{
          ...first,schedules:first.schedules.map((row,i)=>i===2?
            {...row,pendingPersonRef:'not-found'}:row),
        }));
        outcomes.push(await countStable(before,'DUPLICATE_DAY',{
          ...first,schedules:[...first.schedules,first.schedules[0]],
        }));
        outcomes.push(await countStable(before,'UNKNOWN_EXISTING',{
          ...first,schedules:first.schedules.map((row,i)=>i===4?
            {...row,pendingPersonRef:undefined,personId:'missing-owner'}:row),
        }));
        // Conflict on the fifth SQL statement, *after* new person INSERT and
        // three valid schedules. D1.batch must rollback the entire transaction.
        const midFailure=make(start,[newPerson('황테스트')]);
        midFailure.schedules[3].id=before.schedules[0].id;
        outcomes.push(await countStable(before,'SCHEDULE_SQL_ROLLBACK',midFailure));
        // Existing-name collision forces a failed person insert before schedules.
        const duplicateName=make(start,[newPerson(before.people[0].name)]);
        outcomes.push(await countStable(before,'PERSON_INSERT_REJECT',duplicateName));
        const passed=await request(first);
        if(!passed.ok||Object.keys(passed.body?.createdPeople??{}).length!==1)
          throw Error('ATOMIC_SINGLE_PERSON_COMMIT_FAILED');
        const afterFirst=await snapshot();
        if(afterFirst.people.length!==before.people.length+1||
           afterFirst.schedules.length!==before.schedules.length+7)
          throw Error('ATOMIC_SINGLE_PERSON_COUNT_MISMATCH');
        // Simulate a lost response: retry the identical browser request ID
        // and same content, receiving the same server-generated employee id.
        const repeat=await request(first);
        if(!repeat.ok||JSON.stringify(repeat.body?.createdPeople)!==
           JSON.stringify(passed.body.createdPeople))
          throw Error('ATOMIC_RETRY_PERSON_ID_DRIFT');
        const afterRepeat=await snapshot();
        if(JSON.stringify(afterRepeat.people)!==JSON.stringify(afterFirst.people)||
           afterRepeat.schedules.length!==afterFirst.schedules.length)
          throw Error('ATOMIC_REPLAY_DUPLICATE_RECORDS');
        const second=make('2099-02-09',[
          newPerson('한테스트'),newPerson('문테스트'),
        ]);
        const multi=await request(second);
        if(!multi.ok)throw Error('ATOMIC_MULTIPLE_NEW_PEOPLE_FAILED');
        const mixed=make('2099-02-16',[
          newPerson('박테스트'),
        ],[people[0].id]);
        const mixedResponse=await request(mixed);
        if(!mixedResponse.ok)throw Error('ATOMIC_MIXED_EXISTING_NEW_FAILED');
        const final=await snapshot();
        if(final.people.length!==before.people.length+4 ||
           final.schedules.length!==before.schedules.length+7+14+14)
          throw Error('ATOMIC_MIXED_FINAL_COUNT_MISMATCH');
        return {singleNewRows:7,multipleNewRows:14,mixedRows:14,
          negativeCases:outcomes,rollback:true,
          sameRequestReplayNoDuplicate:true,productionD1Writes:0,
          beforePeople:before.people.length,afterPeople:final.people.length,
          beforeSchedules:before.schedules.length,afterSchedules:final.schedules.length};
      },
      async negativeChecks(){
        console.info('CBH_REAL_HTTP_D1_TRACE: NEGATIVE_GATES_BEGIN');
        const baseline=await this.snapshot();
        if(baseline.length!==14)throw Error('Expected exactly 14 persisted local HTTP/D1 rows');
        const create=(personId,date,id='negative-'+date)=>({
          id,personId,date,enabled:true,start:'09:00',end:'18:00',breakMinutes:30,
        });
        const p1=people[0].id,p2=people[1].id;
        const valid=create(p1,'2099-01-12');
        const invalid=[
          {kind:'UNKNOWN_PERSON',rows:[valid,create('unknown-person','2099-01-13')]},
          {kind:'INVALID_DATE',rows:[valid,create(p2,'99-xx-00')]},
          {kind:'INVALID_CLOCK',rows:[valid,{...create(p2,'2099-01-13'),start:'99:77'}]},
          {kind:'DUPLICATE_PERSON_DATE',rows:[valid,{...valid,id:'duplicate-date'}]},
          {kind:'BREAK_OUT_OF_RANGE',rows:[valid,{...create(p2,'2099-01-13'),breakMinutes:900}]},
          {kind:'SQL_BATCH_ROLLBACK',rows:[valid,
            create(p2,'2099-01-13',baseline[0].id)]},
        ];
        const outcomes=[];
        for(const check of invalid){
          const r=await json('/api/schedules/import',{
            method:'PUT',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({schedules:check.rows}),
          });
          if(r.status!==400)throw Error(check.kind+' did not fail closed: '+JSON.stringify(r));
          const after=await this.snapshot();
          if(JSON.stringify(after)!==JSON.stringify(baseline))
            throw Error(check.kind+' partially mutated actual Wrangler D1');
          outcomes.push(check.kind);
        }
        // Existing one-person and single-date routes must retain compatibility.
        const one=baseline.find(x=>x.personId===p1&&x.enabled);
        const single=await json('/api/people/'+encodeURIComponent(p1)+'/schedules/'+one.date);
        if(!single.ok||single.body?.schedule?.id!==one.id)
          throw Error('Single-date GET regression');
        const update=await json('/api/people/'+encodeURIComponent(p1)+'/schedules/'+one.date,{
          method:'PUT',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({...one}),
        });
        if(!update.ok)throw Error('Single-date PUT regression');
        const afterSingle=await this.snapshot();
        if(JSON.stringify(afterSingle)!==JSON.stringify(baseline))
          throw Error('Single-date PUT changed already approved row');
        console.info('CBH_REAL_HTTP_D1_TRACE: NEGATIVE_GATES_PASS');
        return {negativeCases:outcomes,atomicSqlRollbackVerified:true,
          singleDateGetPutBackwardCompatible:true,persisted:baseline.length,
          remoteWrites:0};
      },
    };
  }catch(error){await close();throw error}
}
