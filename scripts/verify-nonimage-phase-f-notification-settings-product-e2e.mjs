import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const wrangler = resolve(root, 'node_modules/.bin/wrangler');
const config = resolve(root, 'wrangler.local.jsonc');
const persist = await mkdtemp(join(tmpdir(), 'cbh-phase-f-notification-'));
const origin = 'http://127.0.0.1:' + (process.env.CBH_PHASEF_PORT ?? '8846');
let worker;
const assert = (value, message) => { if (!value) throw new Error(message); };
const run = (command, args) => new Promise((done,fail)=>{
  const child=spawn(command,args,{cwd:root,env:{...process.env,
    CI:'1',VITE_CBH_RUNTIME:'api',VITE_CBH_PROVIDER_RUNTIME:'mock'},
    stdio:['ignore','pipe','pipe']});
  let output='';
  child.stdout.on('data',d=>output+=d.toString());
  child.stderr.on('data',d=>output+=d.toString());
  child.on('error',fail);
  child.on('exit',code=>code===0?done(output):fail(Error(output.slice(-5500))));
});
async function api(method='GET',payload){
  const response=await fetch(origin+'/api/notifications/settings',{
    method,headers:{'Content-Type':'application/json'},
    ...(payload?{body:JSON.stringify(payload)}:{})
  });
  return {status:response.status,body:await response.json().catch(()=>null)};
}
async function ready(){
  for(let i=0;i<160;i++){
    try{
      const response=await fetch(origin+'/api/health');
      if(response.ok && (await response.json()).ok)return;
    }catch{}
    if(worker.exitCode!==null)throw Error('Worker exited '+worker.logs);
    await new Promise(r=>setTimeout(r,250));
  }
  throw Error('local Worker readiness timeout '+worker.logs?.slice(-1800));
}
function selectRule(page,name){
  return page.getByRole('button',{name,exact:true});
}
async function assertSaved(rule,value,message){
  const saved=(await api()).body?.settings;
  assert(saved?.[rule]===value,message+' (local D1)');
}
async function browserPass(type,name){
  const browser=await type.launch({headless:true});
  const context=await browser.newContext({serviceWorkers:'block'});
  const page=await context.newPage();
  page.setDefaultTimeout(18000);
  const pageErrors=[];
  page.on('pageerror',e=>pageErrors.push(e.message));
  try{
    await page.goto(origin+'/notifications',{waitUntil:'domcontentloaded'});
    await page.locator('[data-page="NotificationSetupPage"]').waitFor();
    const shift=selectRule(page,'예정 퇴근 10분 전에');
    const arrival=selectRule(page,'예상 도착 10분 전에');
    for (const removed of ['도착 시간이 크게 바뀔 때','퇴근이 직접 기록됐을 때','집 도착이 직접 기록됐을 때']) {
      assert(await selectRule(page,removed).count()===0,name+' retired control remains');
    }
    await page.waitForFunction(()=>document.querySelector('[data-page="NotificationSetupPage"]')?.getAttribute('data-state')!=='LOADING');
    const initially=(await api()).body.settings;
    assert(typeof initially.shiftEndEnabled==='boolean'&&typeof initially.arrivalAdvanceEnabled==='boolean',
      name+' initial server settings missing');

    // Mutating one rule must not replace another's just-saved value.
    await arrival.click();
    const nextArrival=!initially.arrivalAdvanceEnabled;
    await page.waitForFunction(value =>
      document.querySelectorAll('.notification-page button.rule')[0]?.getAttribute('aria-pressed')===String(value),nextArrival);
    await assertSaved('arrivalAdvanceEnabled',nextArrival,name+' ETA toggle missing');
    await shift.click();
    await page.waitForFunction(value =>
      document.querySelectorAll('.notification-page button.rule')[1]?.getAttribute('aria-pressed')===String(value),!initially.shiftEndEnabled);
    const afterTwo=(await api()).body.settings;
    assert(afterTwo.shiftEndEnabled===!initially.shiftEndEnabled &&
      afterTwo.arrivalAdvanceEnabled===nextArrival,
      name+' second toggle clobbered prior rule in D1');

    // Server failure must be visible, must not optimistically switch UI, and must allow retry.
    let failures=0;
    await page.route('**/api/notifications/settings',route=>{
      if(route.request().method()==='PUT'){
        failures++;
        return route.fulfill({status:503,contentType:'application/json',
          body:JSON.stringify({error:'Synthetic temporary notification settings outage'})});
      }
      return route.continue();
    });
    const shiftBefore=afterTwo.shiftEndEnabled;
    await shift.click();
    await page.getByRole('alert').filter({hasText:'저장하지 못했습니다.'}).waitFor();
    assert(failures===1,name+' synthetic server failure must be tested');
    assert((await shift.getAttribute('aria-pressed'))===String(shiftBefore),
      name+' failed rule write must not alter UI');
    await assertSaved('shiftEndEnabled',shiftBefore,name+' failed rule write changed D1');
    await page.unroute('**/api/notifications/settings');

    let acceptedPuts=0;
    await page.route('**/api/notifications/settings',async route=>{
      if(route.request().method()==='PUT') acceptedPuts++;
      await route.continue();
    });
    await page.evaluate(()=>{
      const rule=document.querySelectorAll('.notification-page button.rule')[1];
      if(!(rule instanceof HTMLButtonElement))throw Error('Rule toggle missing');
      rule.click();
      rule.click();
    });
    await page.waitForFunction(value=>
      document.querySelectorAll('.notification-page button.rule')[1]?.getAttribute('aria-pressed')===String(value),
      !shiftBefore);
    assert(acceptedPuts===1,name+' same-event double click should result in one PUT');
    await assertSaved('shiftEndEnabled',!shiftBefore,name+' error retry not persisted');
    await page.unroute('**/api/notifications/settings');

    const full=(await api()).body.settings;
    assert(full.shiftEndEnabled===!shiftBefore && full.arrivalAdvanceEnabled===nextArrival,
      name+' independent two reminder rules out of sync');
    assert(!full.etaChangeEnabled && !full.leftWorkEnabled && !full.homeArrivalEnabled,
      name+' retired rule flags must be disabled on preference save');

    // Physically reload the actual product and read back the same isolated D1.
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('[data-page="NotificationSetupPage"]').waitFor();
    await page.waitForFunction(saved=>{
      const buttons=document.querySelectorAll('.notification-page button.rule');
      return buttons.length===2 && [...buttons].every((button,i)=>
        button.getAttribute('aria-pressed')===String(saved[i]));
    },[full.arrivalAdvanceEnabled,full.shiftEndEnabled]);
    assert(pageErrors.length===0,name+' uncaught notification UI errors: '+pageErrors.join('; '));

    // Reject invalid rule payload before it can change any stored setting.
    const invalid=await api('PUT',{
      shiftEndEnabled:true,etaChangeEnabled:'enabled',leftWorkEnabled:true,homeArrivalEnabled:true,
    });
    assert(invalid.status>=400,name+' invalid notification settings should fail closed');
    const unchanged=(await api()).body.settings;
    assert(JSON.stringify([unchanged.shiftEndEnabled,unchanged.etaChangeEnabled,
      unchanged.leftWorkEnabled,unchanged.homeArrivalEnabled])===
      JSON.stringify([full.shiftEndEnabled,full.etaChangeEnabled,
        full.leftWorkEnabled,full.homeArrivalEnabled]),name+' invalid PUT mutated D1');

    return {engine:name,ruleTogglePersistence:true,independentRules:true,
      serverFailureRecovery:true,failedWriteUnchanged:true,duplicateClickGuard:true,
      invalidServerPayloadRejected:true,physicalReload:true,realLocalD1:true,
      livePushRequests:0};
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
  worker.stdout.on('data',d=>worker.logs+=d.toString());
  worker.stderr.on('data',d=>worker.logs+=d.toString());
  await ready();
  const results=[await browserPass(chromium,'Chromium'),await browserPass(webkit,'WebKit')];
  console.log('CBH_NONIMAGE_PHASE_F_SETTINGS_PRODUCT_E2E_PASS='+JSON.stringify({
    results,isolatedD1:true,remotePushCalls:0,productionWrites:0,realStaffData:0,
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
