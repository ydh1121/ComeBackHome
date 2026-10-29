import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { cacheDatabase } from './testing/notification-route-cache-fixture.mjs';

const vite = await createServer({ appType:'custom', logLevel:'error', server:{middlewareMode:true} });
const databases=[];
try {
  const { ProviderNotificationEtaSource } = await vite.ssrLoadModule('/worker/notification-eta-source.ts');
  const { D1NotificationRouteCache, NOTIFICATION_ROUTE_POLICY: policy } = await vite.ssrLoadModule('/worker/notification-route-cache.ts');
  const { ProviderCommuteRepository } = await vite.ssrLoadModule('/src/providers/runtime/ProviderRuntimeRepositories.ts');
  const { planNotificationJobs } = await vite.ssrLoadModule('/worker/notification-planner.ts');
  async function fixture(pairs=1) {
    const database=await cacheDatabase();databases.push(database);database.addPerson('fixture-person');
    const state={ schedule:{id:'fixture-shift',personId:'fixture-person',date:'2026-10-06',enabled:true,start:'09:00',end:'18:00'},
      presence:null,preferred:'fixture-route',location:0,access:0,calls:0,fail:null,delay:null,duration:40 };
    const places={async get(personId,kind){return {id:kind,personId,kind,label:'fixture',address:{road:'fixture'},coordinate:{x:127+state.location/1000+(kind==='origin'?0:0.1),y:37.5}};}};
    const commute={async listSavedRoutes(){return[];},async getPreferredRouteCandidateId(){return state.preferred;},
      async listAccessPoints(personId,kind){return pairs===1?[]:[0,1].map(i=>({id:kind+i,personId,placeKind:kind,providerId:kind+i,
        mode:'SUBWAY',name:'fixture',selected:true,line:'2호선',coordinate:{x:127+(kind==='origin'?0:0.1)+i/100+state.access/10000,y:37.5}}));}};
    const schedules={async getByDate(_id,date){return date===state.schedule.date?structuredClone(state.schedule):null;},async list(){return[structuredClone(state.schedule)];}};
    const providers={kakao:{async publicTransitRoutes(){state.calls++;if(state.delay)await state.delay;if(state.fail)throw new Error(state.fail);return[{id:'fixture-route',totalMinutes:state.duration,transferCount:0,walkMinutes:4}];}},seoulBus:{async arrivals(){throw Error('unrelated live arrival');}},seoulSubway:{async arrivals(){throw Error('unrelated live arrival');}}};
    const cache=new D1NotificationRouteCache(database.db);
    const deps={schedules,places,commute,providers,routeCache:cache,presence:{async get(){return structuredClone(state.presence);}}};
    const source=()=>new ProviderNotificationEtaSource(deps); // A new isolate/runtime each tick.
    return {database,state,deps,source,cache};
  }
  const at=value=>new Date(`2026-10-06T${value}:00+09:00`);
  const start=Date.parse('2026-10-06T00:00:00+09:00');
  const proof=[];
  for(const pairCount of [1,4]) {
    const f=await fixture(pairCount);
    // Reproduce the former fresh-repository-per-minute discovery path with
    // deterministic fake providers. This is NOT measured production traffic.
    for(let minute=0;minute<1440;minute++) {
      await new ProviderCommuteRepository(f.deps.commute,f.deps.places,{search:()=>f.deps.providers.kakao.publicTransitRoutes()}).listRouteCandidates('fixture-person');
    }
    const baseline=f.state.calls;f.state.calls=0;
    let last;
    for(let minute=0;minute<1440;minute++) last=await f.source().get('fixture-person',new Date(start+minute*60_000));
    assert.equal(baseline,1440*pairCount);assert.equal(f.state.calls,pairCount);
    assert.equal(last?.arrivalAt,null);
    const stored=f.database.sqlite.prepare('SELECT * FROM notification_route_cache').get();
    assert.equal(stored.request_count,pairCount);
    assert.equal(stored.fetched_at,at('17:45').toISOString());
    assert.deepEqual(Object.keys(JSON.parse(stored.route_json)).sort(),['id','totalMinutes']);
    assert.match(stored.context_hash,/^[a-f0-9]{64}$/);
    proof.push({selectedPairs:pairCount,previousSyntheticRequests:baseline,newSyntheticRequests:f.state.calls});
  }
  {
    const f=await fixture();
    assert.equal(await f.source().get('fixture-person',at('17:44')),null);
    const first=await f.source().get('fixture-person',at('17:45'));
    assert.equal(first.arrivalAt,at('18:40').toISOString());assert.equal(first.confidence,'FALLBACK');
    f.state.schedule.end='18:15';
    const changed=await f.source().get('fixture-person',at('18:00'));
    assert.equal(changed.arrivalAt,at('18:55').toISOString());assert.equal(f.state.calls,1,'schedule time edits reuse duration but recalculate departure');
    f.state.schedule.enabled=false;assert.equal(await f.source().get('fixture-person',at('18:01')),null);assert.equal(f.state.calls,1);
    f.state.schedule.enabled=true;
    f.state.location++;await f.source().get('fixture-person',at('18:02'));assert.equal(f.state.calls,2,'place edit invalidation');
    f.state.preferred='missing';const missing=await f.source().get('fixture-person',at('18:03'));
    assert.equal(missing.confidence,'UNKNOWN');assert.equal(f.state.calls,3,'preferred route edit invalidation');
    f.state.preferred='fixture-route';await f.source().get('fixture-person',at('18:04'));assert.equal(f.state.calls,4);
    f.state.presence={workDate:f.state.schedule.date,arrivedHomeAt:at('18:05').toISOString()};
    assert.equal(await f.source().get('fixture-person',at('18:06')),null);assert.equal(f.state.calls,4);
  }
  {
    const f=await fixture(4);await f.source().get('fixture-person',at('17:45'));
    f.state.access++;await f.source().get('fixture-person',at('17:46'));assert.equal(f.state.calls,8,'access edit invalidates snapshot');
  }
  {
    const f=await fixture();f.state.presence={workDate:f.state.schedule.date,leftWorkAt:at('12:00').toISOString()};
    const early=await f.source().get('fixture-person',at('12:01'));
    assert.equal(early.arrivalAt,at('12:40').toISOString());assert.equal(early.departureBasis,'ACTUAL');assert.equal(f.state.calls,1);
  }
  {
    const f=await fixture();f.state.schedule.start='22:00';f.state.schedule.end='01:00';
    const nextDay=new Date('2026-10-07T00:45:00+09:00');
    const overnight=await f.source().get('fixture-person',nextDay);
    assert.equal(overnight.arrivalAt,new Date('2026-10-07T01:40:00+09:00').toISOString());
    assert.equal(overnight.workDate,'2026-10-06');assert.equal(f.state.calls,1);
    f.state.schedule.date='2026-10-07';
    await f.source().get('fixture-person',new Date('2026-10-08T00:45:00+09:00'));
    assert.equal(f.state.calls,2,'24h TTL and work date rollover must refresh once');
  }
  {
    const f=await fixture();f.state.duration=300;
    await f.source().get('fixture-person',at('17:45'));
    const long=await f.source().get('fixture-person',at('22:50'));
    assert.equal(long.arrivalAt,at('23:00').toISOString());assert.equal(f.state.calls,1,'known long commute keeps arrival reminder window open without more requests');
  }
  {
    const f=await fixture();f.state.fail='provider unavailable';
    for(let minute=0;minute<1440;minute++)await f.source().get('fixture-person',new Date(start+minute*60_000));
    assert.equal(f.state.calls,9,'failure backoff only in the4h15m preparation/commute window');
    const q=await fixture();q.state.fail='Provider request failed: kakao-map/public-transit-routing HTTP 400 CODE -10';
    for(let minute=0;minute<1440;minute++)await q.source().get('fixture-person',new Date(start+minute*60_000));
    assert.equal(q.state.calls,1,'quota denial suppresses the remaining KST day');
  }
  {
    const f=await fixture(4); // Repeated config changes must not reset the daily budget.
    for(let i=0;i<40;i++){f.state.access++;await f.source().get('fixture-person',new Date(at('17:45').getTime()+i*60_000));}
    assert.equal(f.state.calls,policy.maxRequestsPerPersonDay);
  }
  {
    const f=await fixture();let release;f.state.delay=new Promise(resolve=>{release=resolve;});
    const a=f.source().get('fixture-person',at('17:45'));
    const b=f.source().get('fixture-person',at('17:45'));
    await new Promise(resolve=>setTimeout(resolve,10));release();
    await Promise.all([a,b]);assert.equal(f.state.calls,1,'concurrent cold ticks share an atomic refresh lease');
    const token=await f.cache.acquire('fixture-person','changed',at('18:00'));assert.ok(token);
    assert.equal(await f.cache.acquire('fixture-person','changed',at('18:01')),null);
    const recovered=await f.cache.acquire('fixture-person','changed',at('18:02'));assert.ok(recovered);
    await f.cache.complete('fixture-person',token,{id:'stale',totalMinutes:999},at('18:02'),at('18:32'));
    assert.notEqual((await f.cache.get('fixture-person')).route?.id,'stale','expired owner cannot overwrite a newer lease');
  }
  {
    const f=await fixture();f.database.sqlite.exec('DROP TABLE notification_route_cache');
    const unavailable=await f.source().get('fixture-person',at('17:45'));
    assert.equal(unavailable.confidence,'UNKNOWN');assert.equal(f.state.calls,0,'missing schema must fail closed before any provider request');
  }
  {
    const f=await fixture();let enabled=true,subscribed=true;
    const plans=[];const jobs=new Map();
    const settings={shiftEndEnabled:true,arrivalAdvanceEnabled:true,etaChangeEnabled:false,timezone:'Asia/Seoul'};
    const deps={people:{async list(){return[{id:'fixture-person',name:'검증 인물'}];}},schedules:f.deps.schedules,
      settings:{async get(){return enabled?settings:{...settings,shiftEndEnabled:false,arrivalAdvanceEnabled:false};}},
      subscriptions:{async listActive(){return subscribed?[{}]:[];}},etaSource:{get:(...args)=>f.source().get(...args)},
      plannerState:{async get(){return null;},async upsert(){}},jobs:{
        async enqueueOnce(job){jobs.set(job.dedupeKey,job);},async setArrivalPlan(...args){plans.push(args);}}};
    subscribed=false;await planNotificationJobs(deps,at('17:45').getTime());assert.equal(f.state.calls,0);assert.equal(jobs.size,0);
    subscribed=true;enabled=false;await planNotificationJobs(deps,at('17:45').getTime());assert.equal(f.state.calls,0);
    enabled=true;
    for(let minute=0;minute<=50;minute++)await planNotificationJobs(deps,at('17:45').getTime()+minute*60_000);
    assert.equal(f.state.calls,1);assert.equal(jobs.size,2);
    assert.equal(jobs.get('shift-end:fixture-person:2026-10-06').scheduledFor,at('17:50').toISOString());
    assert.equal(jobs.get('arrival-advance:fixture-person:2026-10-06').scheduledFor,at('18:30').toISOString());
    assert.equal(plans.at(-1)[3],at('18:35').toISOString(),'cheap arrival validation remains fresh every minute for D1 atomic claim');
    f.state.schedule.end='18:10';await planNotificationJobs(deps,at('18:36').getTime());
    assert.equal(jobs.get('arrival-advance:fixture-person:2026-10-06').scheduledFor,at('18:40').toISOString());assert.equal(f.state.calls,1);
  }
  console.log(JSON.stringify({notificationRouteBudget:'PASS',synthetic24h:proof,productionTrafficMeasured:false,
    externalProviderCalls:0,maxBackgroundRouteRequestsPerPersonKstDay:policy.maxRequestsPerPersonDay,
    note:'Foreground route discovery retains its existing60second cache; no schedule UI changes.'}));
} finally {for(const db of databases)db.close();await vite.close();}
