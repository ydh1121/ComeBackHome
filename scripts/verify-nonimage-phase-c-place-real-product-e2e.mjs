import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,webkit} from 'playwright';

const root=fileURLToPath(new URL('../',import.meta.url));
const wrangler=resolve(root,'node_modules/.bin/wrangler');
const config=resolve(root,'wrangler.local.jsonc');
const persist=await mkdtemp(join(tmpdir(),'cbh-phasec-place-map-'));
const origin='http://127.0.0.1:'+(process.env.CBH_PHASEC_PORT??'8837');
let worker;
const assert=(ok,message)=>{if(!ok)throw Error(message);};
const run=(cmd,args)=>new Promise((done,fail)=>{
  const child=spawn(cmd,args,{cwd:root,env:{...process.env,
    CI:'1',VITE_CBH_RUNTIME:'api',VITE_CBH_PROVIDER_RUNTIME:'api'},stdio:['ignore','pipe','pipe']});
  let output='';
  child.stdout.on('data',d=>{output+=d.toString()});
  child.stderr.on('data',d=>{output+=d.toString()});
  child.on('error',fail);
  child.on('exit',code=>code===0?done(output):fail(Error(output.slice(-8000))));
});
async function request(path,method='GET',body){
  const res=await fetch(origin+'/api'+path,{method,
    headers:{'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:res.status,body:await res.json().catch(()=>null)};
}
async function ready(){
  for(let i=0;i<180;i++){
    try{if((await request('/health')).body?.ok)return;}catch{}
    if(worker.exitCode!==null)throw Error('worker exited '+worker.logs);
    await new Promise(done=>setTimeout(done,300));
  }
  throw Error('local worker health timeout '+worker.logs?.slice(-2000));
}
const fixtures=[
 {providerId:'fixture-place-a',placeName:'합성 출발 매장',category:'음식점',
  roadAddress:'서울특별시 강남구 테헤란로 10',lotAddress:'서울특별시 강남구 역삼동 10',
  coordinate:{x:127.028,y:37.5}},
 {providerId:'fixture-place-b',placeName:'합성 도착 매장',category:'건물',
  roadAddress:'서울특별시 마포구 월드컵북로 20',lotAddress:'서울특별시 마포구 성산동 20',
  coordinate:{x:126.92,y:37.56}},
];
const place=(id,kind)=>'/people/'+encodeURIComponent(id)+'/places/'+kind;
const edit=(id,kind)=>'/people/'+encodeURIComponent(id)+'/place/'+kind;
async function navigate(page,route){
  if(!page.url().startsWith(origin)){
    await page.goto(origin+route,{waitUntil:'domcontentloaded'});
  }else{
    await page.evaluate(path=>{
      history.pushState(null,'',path);
      dispatchEvent(new PopStateEvent('popstate'));
    },route);
  }
  await page.locator('[data-page="PlaceEditPage"]').waitFor();
  await page.waitForFunction(kind=>document.querySelector('[data-page="PlaceEditPage"]')?.getAttribute('data-state')?.includes('EDITING_'+kind.toUpperCase()),route.split('/').at(-1),{timeout:15000});
}
async function createPerson(label){
  const result=await request('/people','POST',{name:label,relation:'phasec synthetic'});
  assert(result.status===201&&result.body?.person?.id,'synthetic people seed failed');
  return result.body.person.id;
}
async function search(page,q){
  await page.getByRole('textbox',{name:'주소 또는 장소 검색'}).fill(q);
  await page.locator('[data-state="PLACE_RESULTS"]').waitFor();
}
async function save(page,id){
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await page.waitForURL(new RegExp('/people/'+id+'$'));
}
async function installSyntheticMap(context){
  await context.addInitScript(()=>{
    class LatLng {
      constructor(lat,lng){this.lat=lat;this.lng=lng;}
      getLat(){return this.lat;} getLng(){return this.lng;}
    }
    class MapView {
      constructor(node,options){this.node=node;this.center=options.center;this.level=options.level;}
      setCenter(next){this.center=next;}
    }
    class Overlay {
      constructor(options){
        this.node=options.content;this.map=options.map;
        this.map.node.append(this.node);
      }
      setMap(map){if(!map)this.node.remove();}
      setZIndex(value){this.node.style.zIndex=String(value);}
      getContent(){return this.node;}
    }
    window.kakao={maps:{LatLng,Map:MapView,CustomOverlay:Overlay,
      load(callback){callback();}}};
  });
}
async function browserPass(engine,label,serial){
  const browser=await engine.launch({headless:true});
  const context=await browser.newContext({serviceWorkers:'block'});
  const pageErrors=[];let externalKakaoRequests=0;let providerRequests=0;
  let recoverSearch=false;
  await installSyntheticMap(context);
  await context.route('**/api/client-config',route=>route.fulfill({
    status:200,contentType:'application/json',
    body:JSON.stringify({kakaoMaps:{configured:true,javaScriptKey:'SYNTHETIC_TEST_KEY'}}),
  }));
  await context.route('**/api/providers/place-search?*',route=>{
    providerRequests++;
    const q=new URL(route.request().url()).searchParams.get('q')??'';
    if(q.includes('오류')&&!recoverSearch)
      return route.fulfill({status:503,contentType:'application/json',
        body:JSON.stringify({error:'Synthetic place provider failure'})});
    return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({results:q.includes('없는')?[]:fixtures})});
  });
  await context.route('https://dapi.kakao.com/**',route=>{
    externalKakaoRequests++;
    return route.abort();
  });
  const page=await context.newPage();
  page.setDefaultTimeout(18000);
  page.on('pageerror',error=>pageErrors.push(error.message));
  try{
    const employeeA=await createPerson('합성장소검증'+serial+'갑');
    const employeeB=await createPerson('합성장소검증'+serial+'을');

    await navigate(page,edit(employeeA,'origin'));
    await search(page,'합성 출발');
    await page.locator('[data-map-state="ready"]').waitFor();
    await page.locator('[data-place-id="fixture-place-a"]').click();
    assert((await page.getByRole('textbox',{name:'주소 또는 장소 검색'}).inputValue())===fixtures[0].roadAddress,
      label+' map marker must select exact provider address');
    await page.locator('input').filter({hasNotText:'___phasec_none___'}).count();
    await page.locator('input.input').first().fill('합성 출발지 A');
    await page.locator('input.input').last().fill('7층');
    await save(page,employeeA);
    const first=(await request(place(employeeA,'origin'))).body?.place;
    assert(first?.providerPlaceId===fixtures[0].providerId &&
      first.address.road===fixtures[0].roadAddress &&
      first.address.detail==='7층' &&
      first.coordinate?.x===fixtures[0].coordinate.x,
      label+' selected map pin must persist with full D1 address and coordinates');

    await navigate(page,edit(employeeA,'destination'));
    await search(page,'합성 도착');
    await page.locator('.search-result-row').filter({hasText:'합성 도착 매장'}).click();
    assert((await page.locator('[data-map-state="ready"]').count())===1,
      label+' selected list entry must remain on interactive map');
    await page.locator('input.input').first().fill('합성 도착지 A');
    await save(page,employeeA);
    const dest=(await request(place(employeeA,'destination'))).body?.place;
    assert(dest?.providerPlaceId===fixtures[1].providerId &&
      dest.coordinate?.y===fixtures[1].coordinate.y,
      label+' destination place D1 persistence');
    assert((await request(place(employeeA,'origin'))).body?.place?.providerPlaceId===fixtures[0].providerId,
      label+' destination write must not mix with origin');

    await navigate(page,edit(employeeB,'origin'));
    const searchBox=page.getByRole('textbox',{name:'주소 또는 장소 검색'});
    await searchBox.fill('없는 장소');
    await page.getByText('일치하는 주소·장소가 없습니다.').waitFor();
    assert(await page.getByRole('button',{name:'저장',exact:true}).isDisabled(),
      label+' missing provider resolution must disable save');
    await searchBox.fill('오류 장소');
    await page.getByRole('alert').filter({hasText:'장소 검색에 실패했습니다.'}).waitFor();
    recoverSearch=true;
    await page.getByRole('button',{name:'검색 다시 시도'}).click();
    await page.locator('[data-state="PLACE_RESULTS"]').waitFor();
    await page.locator('.search-result-row').filter({hasText:'합성 도착 매장'}).click();
    await save(page,employeeB);
    const separate=(await request(place(employeeB,'origin'))).body?.place;
    assert(separate?.providerPlaceId===fixtures[1].providerId &&
      (await request(place(employeeA,'origin'))).body?.place?.providerPlaceId===fixtures[0].providerId,
      label+' person A/B place isolation must survive independent writes');

    await navigate(page,edit(employeeA,'origin'));
    const sameId=(await request(place(employeeA,'origin'))).body?.place?.id;
    await search(page,'합성 다른 주소');
    await page.locator('.search-result-row').filter({hasText:'합성 도착 매장'}).click();
    let injectedFailures=0;
    await page.route('**/api/people/'+employeeA+'/places/origin',route=>{
      if(route.request().method()==='PUT'){
        injectedFailures++;
        return route.fulfill({status:503,contentType:'application/json',
          body:JSON.stringify({error:'Synthetic save failure'})});
      }
      return route.continue();
    });
    await page.getByRole('button',{name:'저장',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'저장하지 못했습니다.'}).waitFor();
    assert(injectedFailures===1,label+' place HTTP save must hit injected failure once');
    assert((await searchBox.count())===1 &&
      (await searchBox.inputValue())===fixtures[1].roadAddress,
      label+' failed place save must keep selected input');
    assert((await request(place(employeeA,'origin'))).body?.place?.providerPlaceId===fixtures[0].providerId,
      label+' failed save must leave prior D1 value unchanged');
    await page.unroute('**/api/people/'+employeeA+'/places/origin');
    await save(page,employeeA);
    const updated=(await request(place(employeeA,'origin'))).body?.place;
    assert(updated?.id===sameId && updated.providerPlaceId===fixtures[1].providerId,
      label+' retry must update existing place without duplicate ID');

    // Physical reload: verify persisted location survives a fresh document boot.
    await page.goto(origin+edit(employeeA,'origin'),{waitUntil:'domcontentloaded'});
    await page.locator('[data-page="PlaceEditPage"]').waitFor();
    assert((await page.getByRole('textbox',{name:'주소 또는 장소 검색'}).inputValue())===fixtures[1].roadAddress,
      label+' saved location must hydrate from local D1 after physical reload');

    // A separate no-key WebKit/Chromium context must retain list-only selection.
    const fallback=await browser.newContext({serviceWorkers:'block'});
    try{
      await fallback.route('**/api/client-config',route=>route.fulfill({status:200,
        contentType:'application/json',body:JSON.stringify({kakaoMaps:{configured:false}})}));
      await fallback.route('**/api/providers/place-search?*',route=>route.fulfill({status:200,
        contentType:'application/json',body:JSON.stringify({results:fixtures})}));
      const blank=await fallback.newPage();
      await blank.goto(origin+edit(employeeB,'destination'),{waitUntil:'domcontentloaded'});
      await blank.locator('[data-page="PlaceEditPage"]').waitFor();
      await blank.getByRole('textbox',{name:'주소 또는 장소 검색'}).fill('합성 목적');
      await blank.locator('[data-state="PLACE_RESULTS"]').waitFor();
      await blank.locator('[data-map-state="error"]').waitFor();
      await blank.locator('.search-result-row').filter({hasText:'합성 출발 매장'}).click();
      await blank.getByRole('button',{name:'저장',exact:true}).click();
      await blank.waitForURL(new RegExp('/people/'+employeeB+'$'));
      assert((await request(place(employeeB,'destination'))).body?.place?.providerPlaceId===
        fixtures[0].providerId,label+' no-key map fallback must still persist list selection');
    }finally{await fallback.close();}
    assert(providerRequests>=4,label+' fixture-only place API not exercised');
    assert(externalKakaoRequests===0,label+' live Kakao calls must remain zero');
    assert(pageErrors.length===0,label+' uncaught page exceptions: '+pageErrors.join('; '));
    return {engine:label,searchText:true,searchEmpty:true,searchErrorRetry:true,
      mapMockInteractive:true,mapListSync:true,noSdkListFallback:true,
      originDestinationD1:true,employeeIsolation:true,errorRecovery:true,
      reloadPersistence:true,remoteKakaoRequests:0,localD1:true};
  }finally{await context.close();await browser.close();}
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
  console.log('CBH_NONIMAGE_PHASE_C_REAL_PRODUCT_E2E_PASS='+JSON.stringify({
    results,syntheticPlaces:true,isolatedD1:true,remoteWrites:0,
    liveKakaoRequests:0,realStaffData:0,
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
