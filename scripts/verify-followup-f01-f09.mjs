import assert from 'node:assert/strict';
import { createServer } from 'vite';
const vite = await createServer({ appType: 'custom', logLevel: 'error', server: { middlewareMode: true } });
const load = path => vite.ssrLoadModule('/' + path);
try {
  const { activeWorkSchedule, seoulDate, shiftTimes } = await load('src/domain/product-time.ts');
  assert.equal(seoulDate(new Date('2026-12-31T14:59:59Z')), '2026-12-31');
  assert.equal(seoulDate(new Date('2026-12-31T15:00:00Z')), '2027-01-01');
  assert.equal(shiftTimes({ date:'2026-12-31', start:'22:00', end:'02:00' }).end, Date.parse('2027-01-01T02:00:00+09:00'));
  assert.equal(activeWorkSchedule([{date:'2026-12-31',start:'22:00',end:'02:00',enabled:true}],new Date('2027-01-01T00:01:00+09:00')).date,'2026-12-31');
  const { subwayLines, UNKNOWN_LINE_COLOR } = await load('src/features/transit/subway-lines.ts');
  assert.deepEqual(subwayLines('2호선 → 9호선').map(x => x.color), ['#00A23F','#A49D87']);
  assert.equal(subwayLines('11호선')[0].color, UNKNOWN_LINE_COLOR);
  assert.equal(subwayLines('인천 1호선')[0].color, '#B4C7E7');
  assert.equal(subwayLines('부산 1호선')[0].color, UNKNOWN_LINE_COLOR);
  assert.equal(subwayLines('서울 지하철 1호선')[0].color, '#004A85');
  assert.equal(subwayLines('신분당선')[0].label, '신분당선');

  const { createChangeSignalController } = await load('src/app/changeSignal.ts');
  const documentLifecycle = new EventTarget();
  const changes = createChangeSignalController(documentLifecycle);
  let refreshes = 0;
  changes.subscribe(() => { refreshes++; });
  changes.emit();
  documentLifecycle.dispatchEvent(new Event('pagehide'));
  changes.emit(); changes.emit();
  assert.equal(refreshes, 1, 'unload cleanup must not start fresh queries');
  assert.equal(changes.getVersion(), 1, 'unload freezes the React snapshot');
  documentLifecycle.dispatchEvent(new Event('pageshow'));
  assert.equal(refreshes, 2, 'bfcache restore refreshes persisted cleanup once');
  assert.equal(changes.getVersion(), 2);

  const { calculateArrivalEta } = await load('src/application/services/ArrivalEtaCalculator.ts');
  const departure = Date.parse('2026-10-12T17:00:00+09:00');
  const route = { totalMinutes:40, accessMinutes:3, egressMinutes:4 };
  const now = new Date(departure + 60_000);
  const arrivals = [{minutes:5,observedAt:new Date(departure).toISOString()}];
  const scheduled = calculateArrivalEta({ departureMs:departure, now, route, arrivals });
  assert.equal(scheduled.confidence,'FALLBACK');
  assert.equal(scheduled.departureBasis,'SCHEDULED');
  assert.equal(scheduled.earliestArrivalAt.getTime(),departure + 20*60_000);
  assert.equal(scheduled.latestArrivalAt.getTime(),departure + 60*60_000);
  const actual = calculateArrivalEta({ departureMs:departure, now, route, arrivals,departureBasis:'ACTUAL' });
  assert.equal(actual.confidence,'LIVE');
  assert.equal(actual.arrivalAt.getTime(),departure + 40*60_000,'do not count waiting twice');
  const explicitWait = calculateArrivalEta({ departureMs:departure,now,route:{...route,plannedWaitMinutes:4},arrivals,departureBasis:'ACTUAL' });
  assert.equal(explicitWait.arrivalAt.getTime(),departure + 38*60_000,'replace known waiting, not sum it');
  assert.equal(calculateArrivalEta({departureMs:departure,now:new Date(departure+11*60_000),route}).departureUnconfirmed,true);
  assert.equal(calculateArrivalEta({departureMs:departure,now:new Date(departure+4*60_000),route,arrivals,departureBasis:'ACTUAL'}).confidence,'FALLBACK','cannot track a traveller after boarding');

  assert.equal(calculateArrivalEta({departureMs:departure,now,route:{totalMinutes:2},departureBasis:'ACTUAL'}).earliestArrivalAt.getTime(),departure,'arrival cannot precede actual departure');

  const { buildClockAlarmPlan, reconcileOwnedAlarms, clockShortcutUrl } = await load('src/features/alarms/alarm-plan.ts');
  const alarmNow = new Date('2026-10-11T23:30:00+09:00');
  const entries=[{id:'s',personId:'p',date:'2026-10-12',start:'01:30',end:'08:00',enabled:true}];
  const plan=buildClockAlarmPlan(entries,'synthetic-install',alarmNow);
  assert.deepEqual(plan.targets.map(x=>x.clockTime),['00:00','08:30']);
  assert.equal(plan.deviceApplied,false);
  const personal={id:'personal',label:'wake up',clockTime:'08:00'};
  const spoof={id:'spoof',label:plan.scope+'user-created',clockTime:'08:00'};
  const old={id:'owned-old',label:plan.scope+'old',clockTime:'06:00'};
  const existing={id:'owned-current',label:plan.targets[0].label,clockTime:'00:00'};
  const operations=reconcileOwnedAlarms(plan,[personal,spoof,old,existing],[old,existing],alarmNow);
  assert.deepEqual(operations.removeIds,['owned-old']);
  assert.equal(operations.create.length,1);
  assert.deepEqual(reconcileOwnedAlarms(plan,[],[],alarmNow).removeIds,[]);
  assert.throws(()=>reconcileOwnedAlarms(plan,[],[],new Date(alarmNow.getTime()+6*60_000)),/STALE/);
  assert.equal(buildClockAlarmPlan([{...entries[0],enabled:false}],'synthetic-install',alarmNow).targets.length,0);
  assert.equal(new URL(clockShortcutUrl(plan)).searchParams.get('text'),JSON.stringify(plan));

  const { MockStateStore, MOCK_FIXTURE }=await load('src/mocks/state.ts');
  const mocks=await load('src/mocks/repositories.ts');
  const { ProviderCommuteRepository, systemRuntimeClock }=await load('src/providers/runtime/ProviderRuntimeRepositories.ts');
  const fixture=structuredClone(MOCK_FIXTURE);
  fixture.accessPoints=[];fixture.savedRoutes=[];
  const state=new MockStateStore(fixture);
  const persisted=new mocks.MockCommuteRepository(state);
  const places=new mocks.MockPlaceRepository(state);
  let calls=0;
  const commute=new ProviderCommuteRepository(persisted,places,{async search(){calls++;await new Promise(r=>setTimeout(r,5));return [{id:'route',totalMinutes:30,transferCount:0,walkMinutes:4}];}});
  await Promise.all([commute.listRouteCandidates('mock-person-1'),commute.listRouteCandidates('mock-person-1')]);
  const first=calls;
  await commute.listRouteCandidates('mock-person-1');assert.equal(calls,first);
  assert.ok(commute.getRouteCacheMetrics().sharedRequests>=1);
  assert.equal(commute.getRouteCacheMetrics().ttlMs,60000);
  state.mutate(s=>{s.places[0].coordinate.x+=0.01;});
  await commute.listRouteCandidates('mock-person-1');assert.ok(calls>first);
  assert.ok(commute.getRouteCacheMetrics().invalidations>=1);

  const clockNow = systemRuntimeClock.now;
  try {
    const beforeExpiry = calls;
    systemRuntimeClock.now=()=>new Date(clockNow().getTime()+60001);
    await commute.listRouteCandidates('mock-person-1');
    assert.ok(calls>beforeExpiry,'60-second expiry makes a fresh request');
  } finally {systemRuntimeClock.now=clockNow;}

  const { WorkbookImportFileSelectionAction }=await load('src/application/services/WorkbookImportFileSelectionAction.ts');
  const { BrowserImportRepository }=await load('src/providers/browser/BrowserImportRepository.ts');
  const imports=new BrowserImportRepository();
  let finish,started;
  const began=new Promise(r=>{started=r;});
  const parser={parse:async()=>{started();return new Promise(r=>{finish=r;});}};
  const action=new WorkbookImportFileSelectionAction(imports,{list:async()=>[]},{getByDate:async()=>null},parser);
  const controller=new AbortController();
  const pending=action.accept([{kind:'WORKBOOK',file:new File(['synthetic'],'synthetic.xlsx')}],controller.signal);
  const outcome=pending.then(()=>null,error=>error);
  await began;controller.abort();
  finish({detectedPeople:[],scheduleCandidates:[],structure:{sheet:'fixture',needsReview:false},confidence:1});
  assert.equal((await outcome).name,'AbortError');
  assert.equal((await imports.getCurrentBatch()).reviewItems.length,0,'cancelled parse cannot publish review');
  assert.equal((await imports.getCurrentBatch()).files.length,0,'cancel releases parsing records');

  const { planNotificationJobs }=await load('worker/notification-planner.ts');
  const jobs=new Map();const plans=[];
  const dependencies={
    jobs:{enqueueOnce:async job=>{jobs.set(job.dedupeKey,job);},setArrivalPlan:async(...args)=>plans.push(args)},
    settings:{get:async()=>({timezone:'Asia/Seoul',shiftEndEnabled:true,etaChangeEnabled:false,arrivalAdvanceEnabled:true})},
    plannerState:{get:async()=>null,upsert:async()=>{}},
    people:{list:async()=>[{id:'p',name:'synthetic'}]},
    schedules:{list:async()=>[{id:'s',personId:'p',date:'2026-10-12',enabled:true,start:'09:00',end:'17:00'}]},
    etaSource:{get:async()=>({arrivalAt:'2026-10-12T08:40:00Z',confidence:'FALLBACK'})},
  };
  await planNotificationJobs(dependencies,departure-20*60_000);
  assert.equal(jobs.get('shift-end:p:2026-10-12').scheduledFor,'2026-10-12T07:50:00.000Z');
  assert.equal(jobs.get('arrival-advance:p:2026-10-12').scheduledFor,'2026-10-12T08:30:00.000Z');
  await planNotificationJobs(dependencies,departure-15*60_000);assert.equal(jobs.size,2);
  dependencies.etaSource.get=async()=>({arrivalAt:'2026-10-12T08:40:00Z',confidence:'FALLBACK',departureBasis:'SCHEDULED',departureUnconfirmed:true});
  await planNotificationJobs(dependencies,departure+30*60_000);
  assert.ok(jobs.get('arrival-advance:p:2026-10-12').payload.body.includes('실제 출발 미확인'),'planned reminder must not imply actual departure');
  dependencies.schedules.list=async()=>[];
  await planNotificationJobs(dependencies,departure);assert.equal(plans.at(-1)[2],null,'OFF invalidates pending ETA plan');
  console.log('F01_F09_DOMAIN_CONTRACTS_PASS: KST, overnight, line fallback, ETA ranges, cache sharing/invalidation, cancelled import, alarm ownership, scheduled reminder/OFF');
} finally {await vite.close();}
