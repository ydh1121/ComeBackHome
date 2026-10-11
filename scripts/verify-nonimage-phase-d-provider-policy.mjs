import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const dir=await mkdtemp(join(tmpdir(),'cbh-phase-d-worker-'));
const check=(value,message)=>{if(!value)throw Error(message);};
const origin={x:127.035,y:37.505};
const bus=(id,dx=0,dy=0)=>({id:'seoul-bus:'+id,providerId:id,
  mode:'BUS',name:'합성 정류장',displayCode:id,coordinate:{x:origin.x+dx,y:origin.y+dy}});
const subway=(id,dx=0,dy=0)=>({id:'seoul-subway:'+id,providerId:id,
  mode:'SUBWAY',name:'언주역',line:'9호선',coordinate:{x:origin.x+dx,y:origin.y+dy}});
const place=(id,category,dx=0)=>({providerId:id,placeName:id,roadAddress:'합성 도로',
  category,coordinate:{x:origin.x+dx,y:origin.y}});
const env={PROVIDER_RUNTIME_ENABLED:'1'};
try{
  const out=join(dir,'api.mjs');
  await build({entryPoints:[resolve(root,'worker/api.ts')],bundle:true,
    platform:'node',format:'esm',target:'es2022',outfile:out,
    packages:'bundle',logLevel:'silent'});
  const {handleApiRequest}=await import(pathToFileURL(out).href);
  const invoke=async(path,runtime)=>{
    const response=await handleApiRequest(new Request('http://fixture.invalid/api/providers/'+path),env,runtime);
    return {status:response.status,body:await response.json()};
  };
  const query=(q)=>'transit-search?q='+encodeURIComponent(q)+'&x='+origin.x+'&y='+origin.y;
  const near='transit-nearby?x='+origin.x+'&y='+origin.y;
  const runtime=(busFn,railFn,nearFn,kakaoFn)=>({
    seoulBus:{searchStops:busFn,nearbyStops:nearFn},
    seoulSubway:{searchStations:railFn},
    kakao:{searchPlaces:kakaoFn},
  });

  const normal=runtime(
    async()=>[bus('11111',0.0003),bus('22222',0.0004),bus('11111',0.0003)],
    async()=>[subway('901',0.0008),subway('902',0.00085)],
    async()=>[bus('11111',0.0003),bus('33333',0.03)],
    async(q)=>q.includes('버스')?[place('카페 일반매장','카페')]:
      [place('역이 아닌 상점','음식점'),place('언주역','지하철역',0.00075)]);

  let actual=await invoke(query('언주역'),normal);
  check(actual.status===200&&actual.body.status==='SUCCESS_WITH_RESULTS','official direct query failed');
  check(actual.body.results.length===4,'direct query duplicate IDs or distinct official stops incorrect '+JSON.stringify(actual.body));
  check(actual.body.results.every(x=>['BUS','SUBWAY'].includes(x.mode)),'non-transit result leaked');
  check(actual.body.results.some(x=>x.displayCode==='22222'),'distinct direction stop missing');
  check(actual.body.results.some(x=>x.providerId==='902'),'second official rail stop missing');
  actual=await invoke(near,normal);
  check(actual.body.results.some(x=>x.providerId==='11111'),'nearby actual bus missing');
  check(actual.body.results.every(x=>x.distanceM <= (x.mode==='BUS'?800:900)),'outside bus/rail radius leaked');
  check(!actual.body.results.some(x=>x.providerId==='33333'),'remote bus leaked');
  check(!actual.body.results.some(x=>x.providerId==='카페 일반매장'),'nontransport shop leaked');
  const farDirect=runtime(async()=>[bus('REMOTE',0.2)],async()=>[],async()=>[],async()=>[]);
  actual=await invoke(query('REMOTE'),farDirect);
  check(actual.body.results.some(x=>x.providerId==='REMOTE'),'direct name search wrongly clamped to nearby radius');
  const partial=runtime(async()=>{throw Object.assign(new Error('quota'),{status:429})},
    async()=>[subway('901',0.0002)],async()=>[],async()=>[]);
  actual=await invoke(query('언주'),partial);
  check(actual.status===200&&actual.body.status==='PARTIAL_PROVIDER_FAILURE'&&actual.body.results.length===1,
    'partial bus outage concealed healthy rail result '+JSON.stringify(actual));
  const total=runtime(async()=>{throw Object.assign(new Error('quota'),{status:429})},
    async()=>{throw Object.assign(new Error('quota'),{status:429})},async()=>[],async()=>[]);
  actual=await invoke(query('언주'),total);
  check(actual.status===429&&actual.body.reason==='QUOTA_EXCEEDED',
    'total provider quota failure must be explicit');
  const empty=runtime(async()=>[],async()=>[],async()=>[],async()=>[]);
  actual=await invoke(query('일반 매장'),empty);
  check(actual.status===200&&actual.body.status==='SUCCESS_EMPTY'&&actual.body.results.length===0,
    'verified empty transport search must differ from unavailable');
  actual=await invoke('transit-nearby?x=200&y=95',normal);
  check(actual.status===400&&actual.body.reason==='INVALID_COORDINATE','invalid coordinate not rejected');
  actual=await invoke('transit-search?q=a&x=&y=',normal);
  check(actual.status===400&&actual.body.reason==='INVALID_COORDINATE','blank coordinate not rejected');
  const nearbyPartial=runtime(async()=>[],async()=>[],async()=>{throw Error('network timeout')},
    async(q)=>q.includes('버스')?[place('정류장','버스정류장',0.0005)]:[place('언주역','지하철역',0.0007)]);
  actual=await invoke(near,nearbyPartial);
  check(actual.status===200&&actual.body.status==='PARTIAL_PROVIDER_FAILURE'&&actual.body.results.length>=1,
    'nearby partial official provider failure must not hide valid fallback '+JSON.stringify(actual));
  console.log('CBH_PHASE_D_WORKER_PROVIDER_POLICY_PASS='+JSON.stringify({
    officialSearchOnly:true,duplicateIdentity:true,absoluteDistanceCaps:true,
    directLongRange:true,partialProviderError:true,quotaExplicit:true,
    emptyDistinct:true,invalidCoordinate:true,nearbyPartial:true,
    productionWrites:0,liveProviderCalls:0}));
}finally{await rm(dir,{recursive:true,force:true})}
