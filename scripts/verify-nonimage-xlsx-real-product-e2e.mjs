import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { makeWeeklyXlsx } from '../test/fixtures/import/anonymous-weekly-xlsx-builder.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const config=resolve(root,'wrangler.local.jsonc');
const wrangler=resolve(root,'node_modules/.bin/wrangler');
const port=Number(process.env.CBH_NONIMAGE_XLSX_PORT??'8829');
const origin='http://127.0.0.1:'+port;
const persist=await mkdtemp(join(tmpdir(),'cbh-nonimage-xlsx-e2e-'));
let worker;
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const run=(cmd,args)=>new Promise((resolveDone,reject)=>{
  const child=spawn(cmd,args,{cwd:root,env:{...process.env,CI:'1',VITE_CBH_RUNTIME:'api',VITE_CBH_PROVIDER_RUNTIME:'mock'},stdio:['ignore','pipe','pipe']});
  let output='';
  child.stdout.on('data',d=>{output+=d.toString()});
  child.stderr.on('data',d=>{output+=d.toString()});
  child.on('error',reject);
  child.on('exit',code=>code===0?resolveDone(output):
    reject(Error(cmd+' failed '+code+'\n'+output.slice(-6000))));
});
async function request(path,init){
  const res=await fetch(origin+path,init);
  const body=await res.json().catch(()=>null);
  return {status:res.status,body};
}
async function json(path,method='GET',body=null){
  return request(path,{method,headers:{'Content-Type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{})});
}
async function ready(){
  let last='';
  for(let i=0;i<180;i++){
    if(worker.exitCode!=null)throw Error('Worker exited: '+worker.logs);
    try{const v=await json('/api/health');if(v.body?.ok===true)return;}catch(e){last=String(e);}
    await new Promise(r=>setTimeout(r,300));
  }
  throw Error('local worker startup timeout '+last+'\n'+worker.logs?.slice(-2000));
}
function binaryRoster(firstName,secondName,monday){
  const dates=Array.from({length:7},(_,i)=>
    new Date(Date.parse(monday+'T00:00:00Z')+i*86400000).toISOString().slice(0,10));
  const top=['업무',...Array.from({length:21},(_,i)=>i%3===0?'주간 '+Math.floor(i/3):null)];
  const dateRow=[null,...Array.from({length:21},(_,i)=>i%3===0?dates[Math.floor(i/3)]:null)];
  const fields=['직원',...Array.from({length:21},(_,i)=>['출근','퇴근','쉬는시간'][i%3])];
  const first=[firstName,...Array(21).fill(null)];
  const second=[secondName,...Array(21).fill(null)];
  first.splice(1,3,9.5,23.5,0.5);
  first.splice(7,3,10,20,1);
  second.splice(1,3,14,22,1);
  return {
    bytes:Buffer.from(makeWeeklyXlsx([top,dateRow,fields,first,second])),
    dates,
  };
}
async function testEngine(browserType,label,firstName,secondName,monday){
  const seeded=await json('/api/people','POST',{name:firstName,relation:'synthetic'});
  assert(seeded.status===201&&seeded.body?.person?.id,label+' seeded person missing');
  const originalPersonId=seeded.body.person.id;
  const fixture=binaryRoster(firstName,secondName,monday);
  const browser=await browserType.launch({headless:true});
  let page;
  try{
    const context=await browser.newContext({serviceWorkers:'block'});
    page=await context.newPage();
    page.setDefaultTimeout(20_000);
    const pageErrors=[];
    page.on('pageerror',e=>pageErrors.push(e.message));
    await page.goto(origin+'/import',{waitUntil:'domcontentloaded'});
    await page.locator('input[accept=".xlsx"]').setInputFiles({
      name:'anonymous-weekly.xlsx',
      mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer:fixture.bytes,
    });
    await page.getByRole('button',{name:'인식 결과 보기'}).click();
    const peopleScreen=page.locator('[data-page="ImportPersonMatchPage"]');
    await peopleScreen.waitFor();
    // Option labels contain all existing employees; filter on the row's
    // own bold source name instead of matching descendant option text.
    const personRows=peopleScreen.locator('.mapping-row');
    const firstRow=personRows.nth(0);
    const secondRow=personRows.nth(1);
    assert((await firstRow.locator('b').first().innerText())===firstName &&
      (await secondRow.locator('b').first().innerText())===secondName,
      label+' parsed source roster order mismatch');
    assert((await firstRow.locator('select').inputValue())===originalPersonId,
      label+' existing employee must auto-match');
    assert((await secondRow.locator('select').inputValue())==='',
      label+' missing employee must not auto-create');
    const before=await json('/api/people');
    assert(!before.body?.people?.some(x=>x.name===secondName),
      label+' draft creation must produce ZERO server people writes');
    await secondRow.locator('select').selectOption('__create__');
    await page.getByRole('button',{name:'다음',exact:true}).click();
    await page.locator('[data-page="ImportStructurePage"]').waitFor();
    await page.getByRole('button',{name:'계속',exact:true}).click();
    const review=page.locator('[data-page="ImportReviewPage"]');
    await review.waitFor();
    const rows=review.locator('.import-review-item');
    assert((await rows.count())===14,label+' expected 14 weekly review cells');
    for(let i=0;i<14;i++){
      const row=rows.nth(i);
      if(i===0||i===7){
        await row.locator('.review-choice-list button').last().click();
      }else if(i===8){
        await row.getByRole('button',{name:/휴무로 변경/}).click();
        await row.locator('.review-choice-list button').last().click();
      }else{
        await row.locator('.review-choice-list button').first().click();
      }
    }
    // Edit an approved shift -> approval must be revoked -> reapprove.
    const firstShift=rows.nth(0);
    const timeSelectors=firstShift.locator('.review-time-editor');
    assert((await timeSelectors.count())===1,label+' weekly time editor missing');
    await firstShift.locator('input[aria-label="쉬는시간 분 단위 수정"]').fill('45');
    assert(await page.getByRole('button',{name:'저장',exact:true}).isDisabled(),
      label+' editing approved break minutes must invalidate prior approval');
    await firstShift.locator('.review-choice-list button').last().click();
    const saveEnabled=await page.getByRole('button',{name:'저장',exact:true}).isEnabled();
    if(!saveEnabled) {
      const reviewDetails=await page.evaluate(()=>{
        const batch=JSON.parse(localStorage.getItem('cbh:import-batches:v2')||'{}').batches?.[0];
        return {
          people:batch?.detectedPeople?.map(p=>({name:p.sourceName,pending:p.pendingCreate,id:p.matchedPersonId,ignored:p.ignored})),
          rows:batch?.reviewItems?.map((x,i)=>({i,date:x.date,resolution:x.resolution,
            enabled:x.imported.enabled,start:x.imported.start,end:x.imported.end,
            breakMinutes:x.imported.breakMinutes,recognitionState:x.recognitionState,
            personId:x.personId})),
        };
      });
      throw Error(label+' corrected break must be explicitly reapproved: '+JSON.stringify(reviewDetails));
    }
    const beforeSave=await json('/api/people');
    assert(!beforeSave.body?.people?.some(x=>x.name===secondName),
      label+' review-before-submit MUST remain D1-write-free');
    await page.getByRole('button',{name:'저장',exact:true}).click();
    await page.waitForURL(/\/schedule(?:\?|$)/);
    const after=await json('/api/people');
    const newPerson=after.body?.people?.find(p=>p.name===secondName);
    assert(Boolean(newPerson),label+' approved new person missing');
    const oldSchedule=await json('/api/people/'+originalPersonId+'/schedules/'+fixture.dates[0]);
    const newSchedule=await json('/api/people/'+newPerson.id+'/schedules/'+fixture.dates[0]);
    const newOff=await json('/api/people/'+newPerson.id+'/schedules/'+fixture.dates[1]);
    assert(oldSchedule.body?.schedule?.start==='09:30' &&
      oldSchedule.body?.schedule?.end==='23:30' &&
      oldSchedule.body?.schedule?.breakMinutes===45,
      label+' numeric time D1 readback mismatch');
    assert(newSchedule.body?.schedule?.start==='14:00',
      label+' pending new person D1 shift missing');
    assert(newOff.body?.schedule?.enabled===false,
      label+' explicitly approved OFF not saved');
    await page.reload({waitUntil:'domcontentloaded'});
    assert((await json('/api/people/'+newPerson.id+'/schedules/'+fixture.dates[0])).body?.schedule?.start==='14:00',
      label+' saved new employee shift not persisted after reload');
    assert(pageErrors.length===0,label+' product browser errors: '+pageErrors.join('; '));
    await context.close();
    return {browser:label,workbookBinary:true,peopleMapping:true,
      approvalBeforeWrites:0,reviewItems:14,explicitOff:true,
      d1RoundTrip:true,reloaded:true};
  }finally{await browser.close()}
}
try{
  await run('npm',['run','build']);
  await run(wrangler,['d1','migrations','apply','come-back-home-db','--local',
    '--config',config,'--persist-to',persist]);
  worker=spawn(wrangler,['dev','--local','--config',config,'--persist-to',persist,
    '--port',String(port),'--ip','127.0.0.1',
    '--show-interactive-dev-session=false','--log-level','warn'],
    {cwd:root,env:{...process.env,CI:'1'},stdio:['ignore','pipe','pipe']});
  worker.logs='';
  worker.stdout.on('data',d=>{worker.logs+=d.toString();});
  worker.stderr.on('data',d=>{worker.logs+=d.toString();});
  await ready();
  const chromiumResult=await testEngine(chromium,'Chromium','합성직원마','합성직원바','2099-12-28');
  const webkitResult=await testEngine(webkit,'WebKit','합성직원사','합성직원아','2100-01-04');
  console.log('CBH_NONIMAGE_XLSX_REAL_PRODUCT_E2E_PASS='+JSON.stringify({
    results:[chromiumResult,webkitResult],
    worker:'LOCAL_ISOLATED_D1',privateStaffData:0,remoteWrites:0,
  }));
}finally{
  if(worker&&worker.exitCode==null){
    worker.kill();
    await new Promise(done=>{
      const t=setTimeout(()=>{if(worker.exitCode==null)worker.kill('SIGKILL');done()},3000);
      worker.once('exit',()=>{clearTimeout(t);done()});
    });
  }
  await rm(persist,{recursive:true,force:true});
}
