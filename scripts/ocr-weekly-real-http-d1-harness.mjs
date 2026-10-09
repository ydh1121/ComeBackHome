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
    await run(wrangler,['d1','migrations','apply','come-back-home-db','--local',
      '--config',config,'--persist-to',tmp],{
        cwd:root,env:{...process.env,CI:'true'},maxBuffer:5*1024*1024,
      });
    const port=await freePort();
    origin='http://127.0.0.1:'+port;
    processHandle=spawn(wrangler,[
      'dev','--local','--config',config,'--persist-to',tmp,
      '--ip','127.0.0.1','--port',String(port),
      '--show-interactive-dev-session=false','--log-level','warn',
    ],{cwd:root,env:{...process.env,CI:'true'},stdio:['ignore','pipe','pipe'],shell:false});
    processHandle.stdout.on('data',v=>{output+=v.toString();output=output.slice(-10000)});
    processHandle.stderr.on('data',v=>{output+=v.toString();output=output.slice(-10000)});
    let ready=false;
    for(let i=0;i<120;i++){
      if(processHandle.exitCode!==null)throw Error('Local Wrangler exited: '+output);
      try{if((await json('/api/health')).body?.ok===true){ready=true;break}}catch{}
      await nap(250);
    }
    if(!ready)throw Error('Local Wrangler health failed: '+output);
    const people=[];
    for(const name of ['강하현','정지윤']){
      const r=await json('/api/people',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name,relation:'synthetic-weekly-ocr-only'})});
      if(!r.ok||typeof r.body?.person?.id!=='string')
        throw Error('Unable to seed local D1 person '+name+': '+JSON.stringify(r));
      people.push(r.body.person);stats.postPeople++;
    }
    return{
      origin,people,stats,json,close,
      // Vite owns the only browser origin. Forward only same-origin /api/*
      // to a separate loopback Wrangler HTTP process backed by ephemeral D1.
      async proxy(request,response){
        stats.proxiedApi++;
        const path=new URL(request.url??'/','http://localhost').pathname;
        if(path==='/api/schedules/import'&&request.method==='PUT')stats.atomicImports++;
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
      async negativeChecks(){
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
        return {negativeCases:outcomes,atomicSqlRollbackVerified:true,
          singleDateGetPutBackwardCompatible:true,persisted:baseline.length,
          remoteWrites:0};
      },
    };
  }catch(error){await close();throw error}
}
