import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,webkit} from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url));
const wrangler=resolve(root,'node_modules/.bin/wrangler');
const config=resolve(root,'wrangler.local.jsonc');
const persist=await mkdtemp(join(tmpdir(),'cbh-phase-d-browser-'));
const origin='http://127.0.0.1:'+(process.env.CBH_PHASED_PORT??'8838');
let worker;
const assert=(yes,msg)=>{if(!yes)throw Error(msg)};
const run=(cmd,args)=>new Promise((ok,no)=>{
  const child=spawn(cmd,args,{cwd:root,env:{...process.env,CI:'1',
    VITE_CBH_RUNTIME:'api',VITE_CBH_PROVIDER_RUNTIME:'api'},stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
  child.on('error',no);child.on('exit',code=>code===0?ok(logs):no(Error(logs.slice(-8000))));
});
async function api(path,method='GET',payload){
  const res=await fetch(origin+'/api'+path,{method,headers:{'Content-Type':'application/json'},
    ...(payload===undefined?{}:{body:JSON.stringify(payload)})});
  return {status:res.status,body:await res.json().catch(()=>null)};
}
async function ready(){
  for(let i=0;i<180;i++){
    try{if((await api('/health')).body?.ok)return}catch{}
    if(worker.exitCode!==null)throw Error('worker exited '+worker.logs);
    await new Promise(ok=>setTimeout(ok,250));
  }
  throw Error('worker health timeout '+worker.logs?.slice(-2000));
}
const center={x:127.035,y:37.505},moved={x:127.065,y:37.515};
const stops=[
 {id:'seoul-bus:11111',providerId:'11111',mode:'BUS',name:'합성버스정류장A',displayCode:'11111',
   coordinate:{x:127.0352,y:37.5052},distanceM:45,walkMinutes:1},
 {id:'seoul-bus:22222',providerId:'22222',mode:'BUS',name:'합성버스정류장B',displayCode:'22222',
   coordinate:{x:127.037,y:37.5051},distanceM:180,walkMinutes:3},
 {id:'seoul-subway:901',providerId:'901',mode:'SUBWAY',name:'합성역A',line:'9호선',
   coordinate:{x:127.038,y:37.506},distanceM:290,walkMinutes:4},
 {id:'seoul-subway:902',providerId:'902',mode:'SUBWAY',name:'합성역B',line:'9호선',
   coordinate:{x:127.040,y:37.506},distanceM:430,walkMinutes:6},
 {id:'seoul-bus:FAR',providerId:'FAR',mode:'BUS',name:'원거리정류장',
   coordinate:{x:127.22,y:37.6},distanceM:15000},
 {id:'seoul-subway:UNKNOWN',providerId:'UNKNOWN',mode:'SUBWAY',name:'좌표불명',
   distanceM:null},
];
const movedStop={id:'seoul-bus:99999',providerId:'99999',mode:'BUS',
  name:'새로운지도중심정류장',displayCode:'99999',distanceM:90,
  coordinate:{x:127.0652,y:37.5152}};
const url=id=>'/people/'+encodeURIComponent(id);
async function seed(label){
  const p=await api('/people','POST',{name:'합성 교통직원 '+label,relation:'fixture'});
  assert(p.status===201,'seed synthetic person '+JSON.stringify(p));
  const id=p.body.person.id;
  for(const kind of ['origin','destination']){
    const coordinate=kind==='origin'?center:{x:127.015,y:37.495};
    const r=await api(url(id)+'/places/'+kind,'PUT',{
      label:kind==='origin'?'합성출발주소':'합성도착주소',
      address:{road:'합성 '+kind+' 도로'},coordinate,providerPlaceId:'fixture-'+kind});
    assert(r.status===200,'seed place '+JSON.stringify(r));
  }
  return id;
}
async function mockMap(ctx){
  await ctx.addInitScript(()=>{
    class LatLng{constructor(y,x){this.y=y;this.x=x}getLat(){return this.y}getLng(){return this.x}}
    class KMap{
      constructor(node,options){this.node=node;this.center=options.center;this.listeners={};
        (window.__phaseDMaps??=[]).push(this);}
      getCenter(){return this.center}
      getBounds(){return {contain(){return true}}}
      getNode(){return this.node}
      getProjection(){return null}
      setCenter(value){this.center=value}
      panTo(value){this.center=value}
    }
    class Marker{constructor(o){this.position=o.position}setMap(){}getPosition(){return this.position}}
    class Overlay{
      constructor(o){this.map=o.map;this.node=o.content;this.position=o.position;this.map.node.append(this.node)}
      setMap(map){if(!map)this.node.remove()}
      getContent(){return this.node}
      getPosition(){return this.position}
      setZIndex(i){this.node.style.zIndex=String(i)}
    }
    window.kakao={maps:{Map:KMap,LatLng,Marker,CustomOverlay,
      event:{addListener(map,name,fn){(map.listeners[name]??=[]).push(fn)}},
      load(fn){fn()}}};
    window.__phaseDMoveMap=(x,y)=>{
      const map=window.__phaseDMaps.at(-1);
      if(!map)throw Error('map not initialized');
      map.center=new LatLng(y,x);
      for(const handler of map.listeners.dragend??[])handler();
    };
  });
}
async function ui(page,person,kind,params=''){
  const route=url(person)+'/commute/'+kind+'/access'+params;
  await page.goto(origin+route,{waitUntil:'networkidle'});
  await page.locator('[data-page="TransitAccessPicker"]').waitFor();
}
async function overview(person,kind='origin'){
  const snapshot=await api(url(person)+'/commute?kind='+kind);
  assert(snapshot.status===200,'commute D1 readback failed '+JSON.stringify(snapshot));
  return snapshot.body;
}
async function clickSelect(page,name){
  await page.getByRole('button',{name:name+' 선택',exact:true}).click();
  await page.getByRole('button',{name:name+' 선택 해제',exact:true}).first().waitFor();
}
async function execute(engine,label,tag){
  const browser=await engine.launch({headless:true});
  const ctx=await browser.newContext({serviceWorkers:'block'});
  const problems=[];
  const stats={providerSearches:0,nearbySearches:0,remoteCalls:0};
  let partial=false, slowFirst=false, needQuota=false,searchRecover=false;
  await mockMap(ctx);
  await ctx.route('**/api/client-config',r=>r.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({kakaoMaps:{configured:true,javaScriptKey:'fixture-key'}})}));
  await ctx.route('**/api/providers/transit-nearby?*',async r=>{
    stats.nearbySearches++;
    const x=Number(new URL(r.request().url()).searchParams.get('x'));
    if(slowFirst&&x<127.05)await new Promise(done=>setTimeout(done,1100));
    const items=x>127.05?[movedStop]:stops;
    await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      results:items,status:partial?'PARTIAL_PROVIDER_FAILURE':'SUCCESS_WITH_RESULTS'})});
  });
  await ctx.route('**/api/providers/transit-search?*',async r=>{
    stats.providerSearches++;
    const q=new URL(r.request().url()).searchParams.get('q')??'';
    if(q.includes('오류')&&!searchRecover)
      return r.fulfill({status:429,contentType:'application/json',
        body:JSON.stringify({reason:'QUOTA_EXCEEDED',error:'Synthetic quota exhausted'})});
    const items=q.includes('없는')||q.includes('상점')?[]:
      q.includes('원거리')?[stops[4]]:
        /^\d+$/.test(q)?stops.filter(x=>x.displayCode===q):
        stops.slice(0,4);
    await r.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({results:items,status:items.length?'SUCCESS_WITH_RESULTS':'SUCCESS_EMPTY'})});
  });
  await ctx.route('**/api/providers/transit-resolve?*',r=>r.fulfill({status:200,
    contentType:'application/json',body:JSON.stringify({resolved:{}})}));
  await ctx.route('https://dapi.kakao.com/**',r=>{stats.remoteCalls++;return r.abort()});
  const page=await ctx.newPage();
  page.setDefaultTimeout(18000);
  page.on('pageerror',error=>problems.push(error.message));
  try{
    const a=await seed(tag+'갑'),b=await seed(tag+'을');
    await ui(page,a,'origin');
    await page.locator('[data-map-state="ready"]').waitFor({timeout:8000}).catch(async()=>{
      const diagnosis=await page.evaluate(()=>({
        url:location.href,
        route:document.querySelector('[data-page="TransitAccessPicker"]')?.outerHTML.slice(0,500),
        map:document.querySelector('[data-map-state]')?.getAttribute('data-map-state'),
        kakao:Boolean(window.kakao?.maps),
        mapCount:window.__phaseDMaps?.length??0,
      }));
      throw Error(label+' MOCK_TRANSIT_MAP_STARTUP '+JSON.stringify({diagnosis,pageErrors:problems}));
    });
    await page.locator('.transit-row').first().waitFor();
    const nearbyNames=await page.locator('.transit-row-focus').allTextContents();
    assert(nearbyNames.length===4,label+' near guards must remove distant/unlocated stops: '+nearbyNames);
    assert(nearbyNames[0].includes('합성버스정류장A')&&nearbyNames.at(-1).includes('합성역B'),
      label+' nearby distance order');
    await page.getByRole('button',{name:'버스',exact:true}).click();
    assert(await page.locator('.transit-row').count()===2,label+' bus filter');
    await page.getByRole('button',{name:'지하철',exact:true}).click();
    assert(await page.locator('.transit-row').count()===2,label+' subway filter');
    await page.getByRole('button',{name:'전체',exact:true}).click();
    const before=await overview(a);
    await page.locator('[data-transit-id="seoul-bus:11111"]').click();
    await page.locator('[data-active-id="seoul-bus:11111"]').waitFor();
    assert((await overview(a)).accessPoints.length===before.accessPoints.length,
      label+' marker preview must not mutate D1');
    for(const point of stops.slice(0,4))await clickSelect(page,point.name);
    let saved=(await overview(a)).accessPoints;
    assert(saved.filter(x=>x.selected).length===4,label+' four-mode multi-select did not persist');
    await page.getByRole('button',{name:stops[1].name+' 선택 해제',exact:true}).first().click();
    await page.getByRole('button',{name:stops[1].name+' 선택',exact:true}).waitFor();
    saved=(await overview(a)).accessPoints;
    assert(saved.filter(x=>x.selected).length===3 &&
      saved.find(x=>x.providerId==='11111')?.selected===true,label+' one removal must keep others');
    await page.reload({waitUntil:'networkidle'});
    await page.locator('.transit-selected-chip').first().waitFor();
    assert(await page.locator('.transit-selected-chip').count()===3,label+' persisted selections after reload');
    const q=page.locator('.transit-inline-search input');
    await q.fill('11111');
    await page.locator('.transit-row').first().waitFor();
    assert(await page.locator('.transit-row').count()===1,label+' official bus number inline search');
    await q.fill('원거리');
    await page.getByText('원거리정류장').first().waitFor();
    assert(await page.locator('.transit-row').count()===1,label+' direct search must allow far transit');
    await q.fill('일반 상점');
    await page.getByText('검색 결과가 없습니다.').waitFor();
    await q.fill('오류 제공자');
    await page.getByText('교통 API 호출 한도를 초과했습니다.').first().waitFor();
    searchRecover=true;
    await page.getByRole('button',{name:'검색 다시 시도'}).click();
    await page.locator('.transit-row').first().waitFor();
    await page.getByRole('button',{name:'검색어 지우기'}).click();
    assert(await page.locator('.transit-row').count()===4,label+' clear search returns nearby list');
    const pBefore=(await overview(a)).accessPoints;
    let failedWrite=0;
    await page.route('**/api/people/'+a+'/commute/access/origin',async r=>{
      if(r.request().method()==='PUT'){failedWrite++;return r.fulfill({status:503,
        contentType:'application/json',body:JSON.stringify({error:'Synthetic transit write outage'})})}
      return r.continue();
    });
    await page.getByRole('button',{name:stops[1].name+' 선택',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Synthetic transit write outage'}).waitFor();
    assert(failedWrite===1,label+' failure injection missed actual access D1 write');
    assert(JSON.stringify((await overview(a)).accessPoints)===JSON.stringify(pBefore),
      label+' failed access write changed persisted D1');
    await page.unroute('**/api/people/'+a+'/commute/access/origin');
    await clickSelect(page,stops[1].name);
    assert((await overview(a)).accessPoints.filter(x=>x.selected).length===4,
      label+' retry must succeed without duplicate');
    await page.getByRole('button',{name:'버스',exact:true}).click();
    assert(await page.locator('.transit-row').count()===2,label+' filtering after save');
    await page.getByRole('button',{name:'전체',exact:true}).click();
    partial=true;
    await page.evaluate(()=>window.__phaseDMoveMap(127.065,37.515));
    await page.getByText('일부 교통 제공자가 응답하지 않았습니다.').first().waitFor();
    await page.getByText('새로운지도중심정류장').first().waitFor();
    assert((await api(url(a)+'/places/origin')).body.place.coordinate.x===center.x,
      label+' map pan must not overwrite saved address coordinate');
    const selectedAfterPan=(await overview(a)).accessPoints.filter(x=>x.selected).length;
    assert(selectedAfterPan===4,label+' pan results must not remove saved access selections');
    await page.getByRole('button',{name:'주변 다시 검색'}).click();
    await page.getByText('새로운지도중심정류장').first().waitFor();
    // The previous center deliberately responds AFTER the new center; it must
    // not overwrite the current geographic candidate list.
    slowFirst=true;
    await page.evaluate(([x,y])=>window.__phaseDMoveMap(x,y),[center.x,center.y]);
    await page.waitForTimeout(440);
    await page.evaluate(([x,y])=>window.__phaseDMoveMap(x,y),[moved.x,moved.y]);
    await page.getByText('새로운지도중심정류장').first().waitFor();
    await page.waitForTimeout(1300);
    assert(await page.locator('.transit-row').count()===1 &&
      (await page.locator('.transit-row').first().innerText()).includes('새로운지도중심정류장'),
      label+' stale earlier center request overwrote newer center');
    slowFirst=false;
    await ui(page,a,'destination');
    await page.locator('.transit-row').first().waitFor();
    await clickSelect(page,stops[0].name);
    assert((await overview(a,'destination')).accessPoints.filter(x=>x.selected).length===1,
      label+' destination separate from origin');
    assert((await overview(a,'origin')).accessPoints.filter(x=>x.selected).length===4,
      label+' origin unchanged by destination');
    await ui(page,b,'origin');
    await page.locator('.transit-row').first().waitFor();
    assert((await overview(b)).accessPoints.length===0,label+' employee B initially isolated');
    await clickSelect(page,stops[0].name);
    assert((await overview(b)).accessPoints.filter(x=>x.selected).length===1 &&
      (await overview(a)).accessPoints.filter(x=>x.selected).length===4,
      label+' employee A/B transit D1 isolation');
    const newRoute=await api(url(a)+'/commute/routes','POST',{});
    assert(newRoute.status===200||newRoute.status===201,'saved route create failed '+JSON.stringify(newRoute));
    const routeId=newRoute.body.route.id;
    await ui(page,a,'origin','?routeId='+routeId+'&routeRole=origin');
    await page.locator('.transit-row').first().waitFor();
    await clickSelect(page,stops[0].name);
    await clickSelect(page,stops[2].name);
    await page.reload({waitUntil:'networkidle'});
    let snapshot=await overview(a);
    let route=snapshot.savedRoutes.find(r=>r.id===routeId);
    assert(route?.originAccessPointIds?.length===2,
      label+' origin route access set must store two independent bus+rail points '+JSON.stringify(route));
    await ui(page,a,'destination','?routeId='+routeId+'&routeRole=destination');
    await page.locator('.transit-row').first().waitFor();
    await clickSelect(page,stops[0].name);
    await clickSelect(page,stops[2].name);
    snapshot=await overview(a);
    route=snapshot.savedRoutes.find(r=>r.id===routeId);
    assert(route?.originAccessPointIds?.length===2 && route?.destinationAccessPointIds?.length===2,
      label+' origin and destination route access sets overwritten');
    await page.reload({waitUntil:'networkidle'});
    snapshot=await overview(a);
    route=snapshot.savedRoutes.find(r=>r.id===routeId);
    assert(route?.originAccessPointIds?.length===2&&route?.destinationAccessPointIds?.length===2,
      label+' route access links not durable after reload');
    // Synthetic map SDK unavailable: list must still create a persisted transit selection.
    const fallback=await browser.newContext({serviceWorkers:'block'});
    try{
      await fallback.route('**/api/client-config',r=>r.fulfill({status:200,contentType:'application/json',
        body:JSON.stringify({kakaoMaps:{configured:false}})}));
      await fallback.route('**/api/providers/transit-nearby?*',r=>r.fulfill({status:200,
        contentType:'application/json',body:JSON.stringify({results:stops.slice(0,4),status:'SUCCESS_WITH_RESULTS'})}));
      await fallback.route('**/api/providers/transit-resolve?*',r=>r.fulfill({status:200,
        contentType:'application/json',body:JSON.stringify({resolved:{}})}));
      const blank=await fallback.newPage();
      await blank.goto(origin+url(b)+'/commute/destination/access',{waitUntil:'domcontentloaded'});
      await blank.locator('[data-map-state="error"]').waitFor();
      await clickSelect(blank,stops[1].name);
      assert((await overview(b,'destination')).accessPoints.find(x=>x.providerId==='22222')?.selected===true,
        label+' SDK-unavailable fallback list must save real D1 transit');
    }finally{await fallback.close();}
    assert(stats.remoteCalls===0,label+' live Kakao requests forbidden');
    assert(problems.length===0,label+' page errors '+problems.join('; '));
    return {engine:label,nearDistance:true,filterModes:true,inlineNameNumber:true,
      shopExcluded:true,markerNoWrite:true,multiSelect:true,individualRemoval:true,
      reload:true,quotaRetry:true,partialProvider:true,mapPan:true,originDestination:true,
      peopleIsolation:true,savedRouteMultiple:true,saveFailureSafe:true,fallback:true,
      liveCalls:stats.remoteCalls};
  }finally{await ctx.close();await browser.close()}
}
try{
  await run('npm',['run','build']);
  await run(wrangler,['d1','migrations','apply','come-back-home-db','--local',
    '--config',config,'--persist-to',persist]);
  worker=spawn(wrangler,['dev','--local','--config',config,'--persist-to',persist,
    '--port',new URL(origin).port,'--ip','127.0.0.1',
    '--show-interactive-dev-session=false','--log-level','warn'],{
      cwd:root,env:{...process.env,CI:'1'},stdio:['ignore','pipe','pipe']});
  worker.logs='';worker.stdout.on('data',x=>worker.logs+=x);
  worker.stderr.on('data',x=>worker.logs+=x);
  await ready();
  const results=[await execute(chromium,'Chromium','C'),await execute(webkit,'WebKit','W')];
  console.log('CBH_PHASE_D_REAL_PRODUCT_E2E_PASS='+JSON.stringify({
    results,isolatedD1:true,productionWrites:0,liveProviderCalls:0,privateStaffData:0}));
}finally{
  if(worker&&worker.exitCode===null){worker.kill();
    await new Promise(done=>{const timer=setTimeout(()=>{if(worker.exitCode===null)worker.kill('SIGKILL');done()},3000);
    worker.once('exit',()=>{clearTimeout(timer);done()})})}
  await rm(persist,{recursive:true,force:true});
}
