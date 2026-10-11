import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,webkit} from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url));
const wrangler=resolve(root,'node_modules/.bin/wrangler');
const config=resolve(root,'wrangler.local.jsonc');
const persist=await mkdtemp(join(tmpdir(),'cbh-people-schedule-phaseb-'));
const origin='http://127.0.0.1:'+(process.env.CBH_PHASEB_PORT??'8836');
let worker;
const assert=(v,m)=>{if(!v)throw Error(m)};
const run=(cmd,args)=>new Promise((done,fail)=>{
  const child=spawn(cmd,args,{cwd:root,
    env:{...process.env,CI:'1',VITE_CBH_RUNTIME:'api',VITE_CBH_PROVIDER_RUNTIME:'mock'},
    stdio:['ignore','pipe','pipe']});
  let output='';
  child.stdout.on('data',d=>{output+=d.toString()});
  child.stderr.on('data',d=>{output+=d.toString()});
  child.on('error',fail);
  child.on('exit',code=>code===0?done(output):fail(Error(output.slice(-6500))));
});
async function api(path,method='GET',body){
  const response=await fetch(origin+'/api'+path,{
    method,headers:{'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  return {status:response.status,body:await response.json().catch(()=>null)};
}
async function ready(){
  for(let i=0;i<180;i++){
    try{if((await api('/health')).body?.ok)return;}catch{}
    if(worker.exitCode!==null)throw Error('worker exited: '+worker.logs);
    await new Promise(r=>setTimeout(r,250));
  }
  throw Error('phase B worker health timed out '+worker.logs?.slice(-2000));
}
const update=async(page,route)=>{await page.goto(origin+route,{waitUntil:'domcontentloaded'});};
async function enterPerson(page,name,relation){
  await update(page,'/people/new');
  await page.locator('.person-form input').nth(0).fill(name);
  await page.locator('.person-form input').nth(1).fill(relation);
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await page.waitForURL(/\/people\/[^/]+$/);
  return decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1));
}
async function chooseClock(page,kind,hour,minute){
  const field=page.locator('.time-wheel-field').filter({hasText:kind});
  await field.locator('.time-wheel-trigger').click();
  const columns=page.locator('.time-wheel-column');
  await columns.nth(0).locator('button').filter({hasText:new RegExp('^'+hour+'$')}).click();
  await columns.nth(1).locator('button').filter({hasText:new RegExp('^'+minute+'$')}).click();
  await page.getByRole('button',{name:'완료',exact:true}).click();
}
async function createDay(page,date,{off=false,start='09:30',end='18:30',breakMinutes}={}){
  await update(page,'/schedule/new');
  await page.locator('input[type=date]').fill(date);
  if(off)await page.locator('.schedule-workday-rule').click();
  else {
    await chooseClock(page,'출근',start.slice(0,2),start.slice(3));
    await chooseClock(page,'퇴근',end.slice(0,2),end.slice(3));
    if(breakMinutes!==undefined)
      await page.getByRole('spinbutton',{name:'쉬는시간 분 단위 수정'}).fill(String(breakMinutes));
  }
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await page.waitForURL(/\/schedule$/);
}
async function browserPass(kind,label,serial){
  const browser=await kind.launch({headless:true});
  const context=await browser.newContext({serviceWorkers:'block'});
  const page=await context.newPage();
  page.setDefaultTimeout(18000);
  const failures=[];
  page.on('pageerror',err=>failures.push(err.message));
  try{
    const personA='합성직원B'+serial+'갑';
    const personB='합성직원B'+serial+'을';
    const a=await enterPerson(page,personA,'검증');
    let first=await api('/people/'+a);
    assert(first.status===200&&first.body.person.name===personA,label+' person create readback');
    await update(page,'/people/new');
    await page.locator('.person-form input').nth(0).fill('  '+personA+'  ');
    await page.getByRole('button',{name:'저장',exact:true}).click();
    await page.getByRole('alert').waitFor();
    assert((await page.getByRole('alert').innerText()).includes('같은 이름'),label+' duplicate UI message');
    assert((await page.locator('.person-form input').first().inputValue()).trim()===personA,
      label+' duplicate retains unsaved input');
    assert((await api('/people')).body.people.filter(x=>x.name===personA).length===1,
      label+' duplicate D1 unchanged');
    await update(page,'/people/'+a+'/edit');
    await page.locator('.person-form input').nth(1).fill('수정관계');
    await page.getByRole('button',{name:'저장',exact:true}).click();
    await page.waitForURL(new RegExp('/people/'+a+'$'));
    assert((await api('/people/'+a)).body.person.relation==='수정관계',label+' edit persists');
    const b=await enterPerson(page,personB,'검증');
    await update(page,'/people');
    await page.locator('.person-row').filter({hasText:personA}).click();
    await page.waitForURL(new RegExp('/people/'+a+'$'));
    const day='2099-12-31', offDate='2100-01-01';
    await createDay(page,day,{breakMinutes:30});
    let work=(await api('/people/'+a+'/schedules/'+day)).body.schedule;
    assert(work?.start==='09:30'&&work.end==='18:30'&&work.breakMinutes===30,
      label+' workday created with break');
    const id=work.id;
    await update(page,'/schedule/'+day+'/edit');
    await chooseClock(page,'출근','10','00');
    await page.getByRole('button',{name:'저장',exact:true}).click();
    await page.waitForURL(/\/schedule$/);
    work=(await api('/people/'+a+'/schedules/'+day)).body.schedule;
    assert(work?.id===id&&work.start==='10:00'&&work.breakMinutes===30,
      label+' time-only work edit must preserve break');
    await update(page,'/schedule/'+day+'/edit');
    await page.getByRole('spinbutton',{name:'쉬는시간 분 단위 수정'}).fill('45');
    await page.getByRole('button',{name:'저장',exact:true}).click();
    await page.waitForURL(/\/schedule$/);
    assert((await api('/people/'+a+'/schedules/'+day)).body.schedule?.breakMinutes===45,
      label+' explicit break update');
    await update(page,'/schedule/'+day+'/edit');
    await page.getByRole('spinbutton',{name:'쉬는시간 분 단위 수정'}).fill('');
    await page.getByRole('button',{name:'저장',exact:true}).click();
    await page.waitForURL(/\/schedule$/);
    assert((await api('/people/'+a+'/schedules/'+day)).body.schedule?.breakMinutes===null,
      label+' explicit break clear');
    await update(page,'/schedule/'+day+'/edit');
    await page.locator('.schedule-workday-rule').click();
    assert(await page.getByRole('button',{name:'저장',exact:true}).isEnabled(),
      label+' OFF must not require clock');
    await page.getByRole('button',{name:'저장',exact:true}).click();
    await page.waitForURL(/\/schedule$/);
    await page.reload();
    let off=(await api('/people/'+a+'/schedules/'+day)).body.schedule;
    assert(off?.enabled===false&&off.start===''&&off.end===''&&off.breakMinutes===null,
      label+' existing work -> OFF persisted');
    await createDay(page,offDate,{off:true});
    off=(await api('/people/'+a+'/schedules/'+offDate)).body.schedule;
    assert(off?.enabled===false&&off.start===''&&off.end===''&&off.breakMinutes===null,
      label+' new OFF persisted without fake hours');
    await update(page,'/schedule/'+day+'/edit');
    await page.locator('.schedule-workday-rule').click();
    await chooseClock(page,'출근','11','00');
    await chooseClock(page,'퇴근','20','00');
    await page.getByRole('spinbutton',{name:'쉬는시간 분 단위 수정'}).fill('60');
    await page.getByRole('button',{name:'저장',exact:true}).click();
    await page.waitForURL(/\/schedule$/);
    work=(await api('/people/'+a+'/schedules/'+day)).body.schedule;
    assert(work?.enabled===true&&work.start==='11:00'&&work.end==='20:00'&&work.breakMinutes===60,
      label+' OFF -> work restoration');
    // Person selection must switch the current schedule source.
    await update(page,'/people');
    await page.locator('.person-row').filter({hasText:personB}).click();
    await page.waitForURL(new RegExp('/people/'+b+'$'));
    await update(page,'/schedule');
    assert(!(await page.locator('.schedule-day-card').allTextContents()).join(' ').includes('11:00'),
      label+' staff B must not render staff A schedule');
    assert((await api('/people/'+b+'/schedules')).body.schedules.length===0,
      label+' person B schedule must remain isolated');
    await createDay(page,'2100-01-03',{breakMinutes:15});
    assert((await api('/people/'+a+'/schedules/2100-01-03')).body.schedule===null,
      label+' A must not receive B save');
    await update(page,'/schedule/edit');
    await page.locator('input[type=date]').first().fill('2100-01-04');
    await page.locator('input[type=date]').last().fill('2100-01-11');
    await page.getByRole('button',{name:'화',exact:true}).click();
    await chooseClock(page,'출근','08','00');
    await chooseClock(page,'퇴근','17','00');
    await page.getByRole('button',{name:'적용',exact:true}).click();
    await page.waitForURL(/\/schedule$/);
    const bulk=(await api('/people/'+b+'/schedules')).body.schedules;
    assert(bulk.some(x=>x.date==='2100-01-05'&&x.start==='08:00')&&
      !bulk.some(x=>x.date==='2100-01-06'),label+' weekday range persisted only matching day');
    await page.reload();
    assert((await api('/people/'+b+'/schedules')).body.schedules.length===bulk.length,
      label+' bulk survives reload');
    // Deliberate SQL middle-batch failure: schedule ID belongs to A.
    const before=(await api('/people/'+b+'/schedules')).body.schedules;
    const invalid=await api('/people/'+b+'/schedules','PUT',{schedules:[
      {id:'phaseb-'+label+'-candidate',date:'2100-01-08',enabled:true,start:'09:00',end:'18:00'},
      {id:id,date:'2100-01-09',enabled:true,start:'09:00',end:'18:00'},
    ]});
    assert(invalid.status>=400,label+' invalid bulk must be rejected');
    const after=(await api('/people/'+b+'/schedules')).body.schedules;
    assert(JSON.stringify(before)===JSON.stringify(after),label+' SQL batch must rollback every row');
    assert(failures.length===0,label+' uncaught browser errors: '+failures.join('; '));
    return {engine:label,peopleCreateEdit:true,duplicate409:true,errorUI:true,
      dayCreateEdit:true,breakPreserveUpdateClear:true,workOffRoundtrip:true,
      newOff:true,staffIsolation:true,bulkWeekday:true,d1Persistence:true,sqlRollback:true};
  }finally{await context.close();await browser.close()}
}
try{
  await run('npm',['run','build']);
  await run(wrangler,['d1','migrations','apply','come-back-home-db','--local',
    '--config',config,'--persist-to',persist]);
  worker=spawn(wrangler,['dev','--local','--config',config,'--persist-to',persist,
    '--port',new URL(origin).port,'--ip','127.0.0.1',
    '--show-interactive-dev-session=false','--log-level','warn'],{
      cwd:root,env:{...process.env,CI:'1'},stdio:['ignore','pipe','pipe'],
    });
  worker.logs='';
  worker.stdout.on('data',d=>{worker.logs+=d.toString()});
  worker.stderr.on('data',d=>{worker.logs+=d.toString()});
  await ready();
  const results=[
    await browserPass(chromium,'Chromium','C'),
    await browserPass(webkit,'WebKit','W'),
  ];
  console.log('CBH_NONIMAGE_PHASE_B_REAL_PRODUCT_E2E_PASS='+JSON.stringify({
    results,isolatedD1:true,productionWrites:0,realStaffData:0,
  }));
}finally{
  if(worker&&worker.exitCode===null){
    worker.kill();
    await new Promise(done=>{
      const t=setTimeout(()=>{if(worker.exitCode===null)worker.kill('SIGKILL');done()},3000);
      worker.once('exit',()=>{clearTimeout(t);done()});
    });
  }
  await rm(persist,{recursive:true,force:true});
}
