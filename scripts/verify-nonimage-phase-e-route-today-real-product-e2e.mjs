import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,webkit} from 'playwright';

const root=fileURLToPath(new URL('../',import.meta.url));
const wrangler=resolve(root,'node_modules/.bin/wrangler');
const config=resolve(root,'wrangler.local.jsonc');
const persist=await mkdtemp(join(tmpdir(),'cbh-phase-e-route-today-'));
const base='http://127.0.0.1:'+(process.env.CBH_PHASEE_PORT??'8841');
let worker;
const assert=(x,msg)=>{if(!x)throw Error(msg)};
const run=(command,args)=>new Promise((ok,fail)=>{
  const proc=spawn(command,args,{cwd:root,
    env:{...process.env,CI:'1',VITE_CBH_RUNTIME:'api',VITE_CBH_PROVIDER_RUNTIME:'api'},
    stdio:['ignore','pipe','pipe']});
  let output='';proc.stdout.on('data',x=>output+=x);proc.stderr.on('data',x=>output+=x);
  proc.on('error',fail);
  proc.on('exit',code=>code===0?ok(output):fail(Error(output.slice(-7000))));
});
async function api(path,method='GET',body){
  const res=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:res.status,body:await res.json().catch(()=>null)};
}
async function ready(){
  for(let n=0;n<160;n++){
    try{if((await api('/health')).body?.ok)return;}catch{}
    if(worker.exitCode!==null)throw Error('Worker exited '+worker.logs);
    await new Promise(r=>setTimeout(r,250));
  }
  throw Error('local Worker timed out '+worker.logs?.slice(-1500));
}
const stationA={x:127.025,y:37.505};
const stationB={x:127.068,y:37.525};
const work={x:127.027,y:37.502};
const home={x:127.07,y:37.528};
const todayParts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',
  year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
const vals=Object.fromEntries(todayParts.map(x=>[x.type,x.value]));
const kstDate=vals.year+'-'+vals.month+'-'+vals.day;
const uri=id=>'/people/'+encodeURIComponent(id);
const routeFixture=[
 {id:'fixture-route-100',totalMinutes:39,transferCount:1,walkMinutes:6,
   accessMinutes:3,egressMinutes:4,fare:1500,
   steps:[{type:'WALKING',label:'합성 출발 도보'},{type:'BUS',label:'합성 정류장 A → 합성 정류장 B'},
     {type:'SUBWAY',label:'합성 목적지 역'},{type:'WALKING',label:'합성 마지막 도보'}],
   busLegs:[{stopNames:['합성 정류장 A','합성 정류장 B'],
     routes:[{providerRouteId:'route-100',routeNo:'100',directionLabel:'합성 목적지 방면'}]}]},
 {id:'fixture-route-200',totalMinutes:44,transferCount:0,walkMinutes:8,
   accessMinutes:5,egressMinutes:3,
   steps:[{type:'WALKING',label:'합성 출발 도보'}, {type:'SUBWAY',label:'합성 대체 지하철'},
     {type:'WALKING',label:'합성 목적지 도보'}]},
];
async function seed(suffix){
  const p=await api('/people','POST',{name:'합성 경로직원 '+suffix,relation:'fixture'});
  assert(p.status===201,'synthetic person create '+JSON.stringify(p));
  const id=p.body.person.id;
  for(const [kind,point] of [['origin',work],['destination',home]]){
    const place=await api(uri(id)+'/places/'+kind,'PUT',{
      label:'합성 '+kind,address:{road:'합성 사무실 '+kind},coordinate:point,
      providerPlaceId:'fixture-'+kind});
    assert(place.status===200,'place seed failed '+JSON.stringify(place));
  }
  const entry=await api(uri(id)+'/schedules','PUT',{schedules:[{
    id:crypto.randomUUID(),personId:id,date:kstDate,enabled:true,start:'08:00',end:'17:00',
  }]});
  assert(entry.status>=200&&entry.status<300,'schedule seed '+JSON.stringify(entry));
  const refs={};
  for(const [kind,point,providerId,mode,name] of [
    ['origin',stationA,'fixture-stop-a','BUS','합성 정류장 A'],
    ['destination',stationB,'fixture-station-b','SUBWAY','합성 목적지 역']]){
    const access=await api(uri(id)+'/commute/access/'+kind,'PUT',{
      id:crypto.randomUUID(),personId:id,placeKind:kind,providerId,mode,name,
      selected:true,coordinate:point,
      ...(mode==='BUS'?{selectedBusRouteId:'route-100'}:{line:'9호선'}),
    });
    assert(access.status===200,'access seed '+JSON.stringify(access));
    refs[kind]=access.body.accessPoint.id;
  }
  const saved=await api(uri(id)+'/commute/routes','POST',{});
  assert(saved.status===201,'saved route create '+JSON.stringify(saved));
  const routeId=saved.body.route.id;
  const savedUpdate=await api(uri(id)+'/commute/routes/'+routeId,'PUT',{
    originAccessPointIds:[refs.origin],destinationAccessPointIds:[refs.destination],
    viaAccessPointIds:[],active:true,
  });
  assert(savedUpdate.status===200,'saved route access update '+JSON.stringify(savedUpdate));
  return {id,routeId,refs};
}
async function browserPass(engine,label,suffix){
  const browser=await engine.launch({headless:true});
  const context=await browser.newContext({serviceWorkers:'block'});
  const errors=[];
  const stats={queries:0,busArrivals:0,realCalls:0,forcedFail:false,orderReversed:false};
  await context.route('**/api/providers/routes?*',async route=>{
    stats.queries++;
    const url=new URL(route.request().url());
    assert(url.searchParams.has('originX'),'provider route search must use real origin coordinate');
    const pairs=[url.searchParams.get('originX'),url.searchParams.get('destinationX')];
    const onChosenPoints=Math.abs(Number(pairs[0])-stationA.x)<0.0001 &&
      Math.abs(Number(pairs[1])-stationB.x)<0.0001;
    if(stats.forcedFail)return route.fulfill({status:400,contentType:'application/json',
      body:JSON.stringify({error:'Provider request failed: kakao-map/public-transit-routing HTTP 400 CODE -10'})});
    // Only the chosen origin/destination access combination yields routes.
    const results=onChosenPoints
      ? (stats.orderReversed?[...routeFixture].reverse():routeFixture)
      : [];
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({results})});
  });
  await context.route('**/api/providers/bus-arrivals?*',route=>{
    stats.busArrivals++;
    return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({arrivals:[{minutes:5,observedAt:new Date().toISOString()}]})});
  });
  await context.route('**/api/providers/subway-arrivals?*',route=>route.fulfill({
    status:200,contentType:'application/json',body:'{"arrivals":[]}',
  }));
  await context.route('https://dapi.kakao.com/**',route=>{stats.realCalls++;return route.abort();});
  const page=await context.newPage();page.setDefaultTimeout(18000);
  page.on('pageerror',error=>errors.push(error.message));
  try{
    const a=await seed('A-'+suffix);
    const b=await seed('B-'+suffix);
    await context.addInitScript(id=>{
      try { localStorage.setItem('cbh:selected-person-id',id); } catch {}
    },a.id);
    const open=async(path,reload=false)=>{
      if(reload||!page.url().startsWith(base)){
        await page.goto(base+path,{waitUntil:'domcontentloaded'});
      }else{
        await page.evaluate(path=>{history.pushState(null,'',path);
          dispatchEvent(new PopStateEvent('popstate'));},path);
      }
      await page.waitForFunction(path=>location.pathname===path,path,{timeout:15000});
    };
    await open(uri(a.id)+'/commute');
    await page.locator('[data-route-candidate-count="2"]').waitFor();
    const cards=page.locator('.route-candidate');
    assert(await cards.count()===2,label+' should see two real candidate cards');
    assert((await page.locator('[data-route-pair-count]').getAttribute('data-route-pair-count'))!=='0',
      label+' selected transport combinations did not reach provider');
    await cards.filter({hasText:'합성 대체 지하철'}).click();
    assert((await api(uri(a.id)+'/commute?kind=origin')).body.preferredRouteCandidateId===null,
      label+' candidate click MUST NOT write D1');
    await page.getByRole('button',{name:'선택한 추천 경로 저장'}).click();
    await page.getByText('선택한 추천 경로를 저장했습니다.').waitFor();
    let readback=(await api(uri(a.id)+'/commute?kind=origin')).body;
    assert(readback.preferredRouteCandidateId==='fixture-route-200',
      label+' selected alternative not persisted');
    const previousQueries=stats.queries;
    await open('/');
    const today=page.locator('[data-page="TodayPage"]');
    await page.locator('[data-page="TodayPage"][data-selected-route-id="fixture-route-200"]').waitFor();
    assert((await today.innerText()).includes('합성 대체 지하철'),
      label+' Today did not render actual D1-selected alternative');
    assert((await today.getAttribute('data-eta-status'))!=='UNKNOWN',
      label+' valid selected route should have ETA');
    assert(stats.queries>=previousQueries,label+' provider calls accounting invalid');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('[data-page="TodayPage"][data-selected-route-id="fixture-route-200"]').waitFor();

    // Alter the preferred candidate and verify exact Today steps replace old.
    await open(uri(a.id)+'/commute');
    await page.locator('[data-route-candidate-count="2"]').waitFor();
    await page.locator('.route-candidate').filter({hasText:'합성 정류장 A'}).click();
    await page.getByRole('button',{name:'선택한 추천 경로 저장'}).click();
    await page.getByText('선택한 추천 경로를 저장했습니다.').waitFor();
    assert((await api(uri(a.id)+'/commute?kind=origin')).body.preferredRouteCandidateId==='fixture-route-100',
      label+' changed preference not saved');
    await open('/');
    await page.locator('[data-page="TodayPage"][data-selected-route-id="fixture-route-100"]').waitFor();
    assert((await today.innerText()).includes('합성 정류장 A') &&
      !(await today.innerText()).includes('합성 대체 지하철'),
      label+' Today steps differ from selected route');
    assert((await api(uri(b.id)+'/commute?kind=origin')).body.preferredRouteCandidateId===null,
      label+' different employee must not inherit preferred candidate');

    // Stable ID despite changed ETA and input-order response changes.
    stats.orderReversed=true;
    await open(uri(a.id)+'/commute');
    await page.locator('[data-route-candidate-count="2"]').waitFor();
    assert((await page.locator('.route-candidate.selected').getAttribute('data-route-candidate-id'))===
      'fixture-route-100',label+' preference must remain selected after reorder');

    // A failed PUT is visible and cannot replace the D1 preference.
    await page.locator('.route-candidate').filter({hasText:'합성 대체 지하철'}).click();
    let failedSaves=0;
    await page.route('**/api/people/'+a.id+'/commute/preferred-route',route=>{
      if(route.request().method()==='PUT'){
        failedSaves++;
        return route.fulfill({status:503,contentType:'application/json',
          body:JSON.stringify({error:'Synthetic provider save failure'})});
      }
      return route.continue();
    });
    await page.getByRole('button',{name:'선택한 추천 경로 저장'}).click();
    await page.getByRole('alert').waitFor();
    assert(failedSaves===1,label+' failed preferred route PUT must attempt exactly once');
    assert((await api(uri(a.id)+'/commute?kind=origin')).body.preferredRouteCandidateId===
      'fixture-route-100',label+' failed preference PUT must not mutate D1');
    await page.unroute('**/api/people/'+a.id+'/commute/preferred-route');
    await page.getByRole('button',{name:'선택한 추천 경로 저장'}).click();
    await page.getByText('선택한 추천 경로를 저장했습니다.').waitFor();
    assert((await api(uri(a.id)+'/commute?kind=origin')).body.preferredRouteCandidateId===
      'fixture-route-200',label+' explicit retry must persist requested candidate');

    // A saved-route access configuration change invalidates old preference.
    const r=await api(uri(a.id)+'/commute/routes/'+a.routeId,'PUT',{
      originAccessPointIds:[],destinationAccessPointIds:[],
      viaAccessPointIds:[],active:true,
    });
    assert(r.status===200,label+' route selection configuration edit failed');
    readback=(await api(uri(a.id)+'/commute?kind=origin')).body;
    assert(readback.preferredRouteCandidateId===null,
      label+' saved route configuration update must revoke stale preferred candidate');
    stats.forcedFail=true;
    // A full reload constructs a new runtime so a successful 60-second
    // in-memory discovery cache cannot mask the synthetic quota denial.
    await page.goto(base+uri(a.id)+'/commute',{waitUntil:'domcontentloaded'});
    await page.locator('[data-route-search-status="QUOTA_EXCEEDED"]').waitFor();
    assert((await page.getByText(/한도가 초과/).count())>0,
      label+' quota exceeded must not be rendered as an empty route set');
    assert((await api(uri(a.id)+'/commute?kind=origin')).body.savedRoutes.length===1,
      label+' quota failure must not erase persisted route configuration');
    stats.forcedFail=false;
    assert(stats.realCalls===0,label+' live Kakao requests forbidden');
    assert(errors.length===0,label+' browser exception '+errors.join('; '));
    return {engine:label,twoRoutes:true,selectedTransportPriority:true,
      explicitSave:true,d1Readback:true,reloadPersistence:true,changedToday:true,
      routeIdOnResponseReorder:true,personIsolation:true,saveErrorRecovery:true,
      activeSavedRouteInvalidatesPreference:true,quotaExplicit:true,
      realProviderCalls:0};
  }finally{await context.close();await browser.close();}
}
try{
  await run('npm',['run','build']);
  await run(wrangler,['d1','migrations','apply','come-back-home-db','--local',
    '--config',config,'--persist-to',persist]);
  worker=spawn(wrangler,['dev','--local','--config',config,'--persist-to',persist,
    '--port',new URL(base).port,'--ip','127.0.0.1',
    '--show-interactive-dev-session=false','--log-level','warn'],{
    cwd:root,env:{...process.env,CI:'1'},stdio:['ignore','pipe','pipe']});
  worker.logs='';worker.stdout.on('data',x=>worker.logs+=x);
  worker.stderr.on('data',x=>worker.logs+=x);
  await ready();
  const results=[await browserPass(chromium,'Chromium','C'),
    await browserPass(webkit,'WebKit','W')];
  console.log('CBH_NONIMAGE_PHASE_E_REAL_PRODUCT_E2E_PASS='+JSON.stringify({
    results,isolatedD1:true,productionWrites:0,liveProviderCalls:0,realStaffData:0}));
}finally{
  if(worker&&worker.exitCode===null){worker.kill();
    await new Promise(done=>{const t=setTimeout(()=>{if(worker.exitCode===null)worker.kill('SIGKILL');done()},3000);
    worker.once('exit',()=>{clearTimeout(t);done()})})}
  await rm(persist,{recursive:true,force:true});
}