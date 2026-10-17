import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { makeWeeklyXlsx } from '../test/fixtures/import/anonymous-weekly-xlsx-builder.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const wrangler = resolve(root, 'node_modules/.bin/wrangler');
const config = resolve(root, 'wrangler.local.jsonc');
const persist = await mkdtemp(join(tmpdir(), 'cbh-phase-g-full-chain-'));
const base = 'http://127.0.0.1:' + (process.env.CBH_PHASEG_PORT ?? '8851');
let worker, referenceServer, referenceBase;
const assert = (v, message) => { if (!v) throw Error(message); };
const run = (cmd, args) => new Promise((done, fail) => {
  const child = spawn(cmd, args, { cwd: root,
    env: { ...process.env, CI: '1', VITE_CBH_RUNTIME: 'api', VITE_CBH_PROVIDER_RUNTIME: 'api' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  child.on('error', fail);
  child.on('exit', code => code === 0 ? done(out) : fail(Error(out.slice(-8000))));
});
const pathFor = id => '/people/' + encodeURIComponent(id);
async function api(path, method = 'GET', data, headers = {}) {
  const response = await fetch(base + '/api' + path, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}
async function ready() {
  for (let i = 0; i < 180; i++) {
    try { if ((await api('/health')).body?.ok) return; } catch {}
    if (worker.exitCode !== null) throw Error('local Worker exited: ' + worker.logs?.slice(-2000));
    await new Promise(r => setTimeout(r, 250));
  }
  throw Error('Phase G isolated local Worker not ready: ' + worker.logs?.slice(-2000));
}
const dateParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
}).formatToParts(new Date());
const parts = Object.fromEntries(dateParts.map(item => [item.type, item.value]));
const todayKst = parts.year + '-' + parts.month + '-' + parts.day;
const work = { x: 127.027, y: 37.502 }, home = { x: 127.070, y: 37.528 };
const stationA = { x: 127.025, y: 37.505 }, stationB = { x: 127.068, y: 37.525 };
const routeResult = [{
  id: 'synthetic-phase-g-selected', totalMinutes: 39, transferCount: 1,
  walkMinutes: 6, accessMinutes: 3, egressMinutes: 4,
  steps: [{ type: 'WALKING', label: '합성 출발 도보' },
    { type: 'BUS', label: '합성 정류장 A → 합성 정류장 B' },
    { type: 'SUBWAY', label: '합성 목적지 역' },
    { type: 'WALKING', label: '합성 도착 도보' }],
  busLegs: [{ stopNames: ['합성 정류장 A', '합성 정류장 B'],
    routes: [{ providerRouteId: 'route-100', routeNo: '100',
      directionLabel: '합성 목적지 방면' }] }],
}];

function makeRoster(first, second) {
  const dates = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.parse(todayKst + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10));
  const header = ['업무', ...Array.from({ length: 21 }, (_, i) => i % 3 === 0 ? '주간 ' + (i / 3) : null)];
  const dateRow = [null, ...Array.from({ length: 21 }, (_, i) => i % 3 === 0 ? dates[i / 3] : null)];
  const fields = ['직원', ...Array.from({ length: 21 }, (_, i) => ['출근', '퇴근', '쉬는시간'][i % 3])];
  const a = [first, ...Array(21).fill(null)], b = [second, ...Array(21).fill(null)];
  a.splice(1, 3, 9.5, 23.5, 0.5);
  a.splice(7, 3, 10, 20, 1);
  b.splice(1, 3, 14, 22, 1);
  return Buffer.from(makeWeeklyXlsx([header, dateRow, fields, a, b]));
}

async function engineTest(engine, label) {
  const seedA = await api('/people', 'POST', { name: '통합 합성직원 A ' + label, relation: 'test' });
  assert(seedA.status === 201, label + ' staff creation failed');
  const id = seedA.body.person.id;
  const secondName = '통합 합성직원 B ' + label;
  const browser = await engine.launch({ headless: true });
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const errors = [], stats = { mockRoutes: 0, remoteCalls: 0 };
  await ctx.route('**/api/providers/routes?*', route => {
    stats.mockRoutes++;
    const u = new URL(route.request().url());
    const x = Number(u.searchParams.get('originX'));
    const dest = Number(u.searchParams.get('destinationX'));
    const matched = Math.abs(x - stationA.x) < 0.0001 && Math.abs(dest - stationB.x) < 0.0001;
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ results: matched ? routeResult : [] }) });
  });
  await ctx.route('**/api/providers/bus-arrivals?*', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ arrivals: [{ minutes: 5, observedAt: new Date().toISOString() }] }) }));
  await ctx.route('**/api/providers/subway-arrivals?*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"arrivals":[]}' }));
  await ctx.route('https://dapi.kakao.com/**', route => { stats.remoteCalls++; return route.abort(); });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  try {
    // One real XLSX binary, browser review, explicit commit, and new staff row.
    await page.goto(base + '/import', { waitUntil: 'domcontentloaded' });
    await page.locator('input[accept=".xlsx"]').setInputFiles({
      name: 'weekly-chain.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: makeRoster(seedA.body.person.name, secondName),
    });
    await page.getByRole('button', { name: '인식 결과 보기' }).click();
    const mapping = page.locator('[data-page="ImportPersonMatchPage"]');
    await mapping.waitFor();
    const mapRows = mapping.locator('.mapping-row');
    assert((await mapRows.nth(0).locator('select').inputValue()) === id,
      label + ' existing employee XLSX mapping failed');
    assert((await mapRows.nth(1).locator('select').inputValue()) === '',
      label + ' new employee must require approval');
    const before = await api('/people');
    assert(!before.body.people.some(p => p.name === secondName), label + ' preapproval staff write');
    await mapRows.nth(1).locator('select').selectOption('__create__');
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await page.locator('[data-page="ImportStructurePage"]').waitFor();
    await page.getByRole('button', { name: '계속', exact: true }).click();
    const review = page.locator('[data-page="ImportReviewPage"]');
    await review.waitFor();
    const rows = review.locator('.import-review-item');
    assert(await rows.count() === 14, label + ' expected 14 XLSX review rows');
    for (let i = 0; i < 14; i++) {
      const row = rows.nth(i);
      if (i === 0 || i === 7) await row.locator('.review-choice-list button').last().click();
      else if (i === 8) {
        await row.getByRole('button', { name: /휴무로 변경/ }).click();
        await row.locator('.review-choice-list button').last().click();
      } else await row.locator('.review-choice-list button').first().click();
    }
    await page.waitForFunction(() => {
      const save = document.querySelector('[data-page="ImportReviewPage"] button.cta');
      return save instanceof HTMLButtonElement && !save.disabled;
    });
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page.waitForURL(/\/schedule(?:\?|$)/);
    const saved = await api(pathFor(id) + '/schedules/' + todayKst);
    const newEmployee = (await api('/people')).body.people.find(p => p.name === secondName);
    assert(saved.body?.schedule?.end === '23:30' && saved.body.schedule.breakMinutes === 30 &&
      Boolean(newEmployee), label + ' XLSX commit did not reach canonical D1');

    // The same employee and same isolated D1 now feed geographic and transit setup.
    for (const [kind, position] of [['origin', work], ['destination', home]]) {
      const place = await api(pathFor(id) + '/places/' + kind, 'PUT', {
        label: '합성 ' + kind, address: { road: '합성 통합 주소 ' + kind },
        coordinate: position, providerPlaceId: 'phase-g-' + kind,
      });
      assert(place.status === 200, label + ' place D1 save ' + kind);
    }
    const ids = {};
    for (const [kind, position, providerId, mode, name] of [
      ['origin', stationA, 'phase-g-bus-a', 'BUS', '합성 정류장 A'],
      ['destination', stationB, 'phase-g-subway-b', 'SUBWAY', '합성 목적지 역'],
    ]) {
      const found = await api(pathFor(id) + '/commute/access/' + kind, 'PUT', {
        id: crypto.randomUUID(), personId: id, placeKind: kind,
        providerId, mode, name, selected: true, coordinate: position,
        ...(mode === 'BUS' ? { selectedBusRouteId: 'route-100' } : { line: '9호선' }),
      });
      assert(found.status === 200, label + ' transit selection D1 save ' + kind);
      ids[kind] = found.body.accessPoint.id;
    }
    const created = await api(pathFor(id) + '/commute/routes', 'POST', {});
    assert(created.status === 201, label + ' saved route create');
    const routeId = created.body.route.id;
    const update = await api(pathFor(id) + '/commute/routes/' + routeId, 'PUT', {
      originAccessPointIds: [ids.origin], destinationAccessPointIds: [ids.destination],
      viaAccessPointIds: [], active: true,
    });
    assert(update.status === 200, label + ' route save');
    await page.evaluate(id => localStorage.setItem('cbh:selected-person-id', id), id);
    await page.goto(base + pathFor(id) + '/commute', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-route-candidate-count="1"]').waitFor();
    assert(Number(await page.locator('[data-route-pair-count]').getAttribute('data-route-pair-count')) > 0,
      label + ' transit choice did not reach route candidate engine');
    await page.locator('.route-candidate').filter({ hasText: '합성 정류장 A' }).click();
    await page.getByRole('button', { name: '선택한 추천 경로 저장' }).click();
    await page.getByText('선택한 추천 경로를 저장했습니다.').waitFor();
    const storedRoute = (await api(pathFor(id) + '/commute?kind=origin')).body;
    assert(storedRoute.preferredRouteCandidateId === 'synthetic-phase-g-selected',
      label + ' selected candidate not persisted in D1');
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-page="TodayPage"][data-selected-route-id="synthetic-phase-g-selected"]').waitFor();
    const todayScreen = page.locator('[data-page="TodayPage"]');
    assert((await todayScreen.innerText()).includes('합성 정류장 A') &&
      (await todayScreen.getAttribute('data-eta-status')) !== 'UNKNOWN',
      label + ' selected route and ETA did not reach Today');

    const followup = process.env.CBH_FOLLOWUP_E2E === '1'
      ? await (await import('./followup-product-assertions.mjs')).verifyFollowupUi({page,api,id,base,todayKst}) : undefined;

    if (referenceBase) {
      const referencePage = await ctx.newPage();
      try {
        await referencePage.addInitScript(personId => localStorage.setItem('cbh:selected-person-id',personId),id);
        Object.assign(followup, await (await import('./followup-product-assertions.mjs')).verifyClockReferenceUi({page:referencePage,base:referenceBase}));
      } finally { await referencePage.close(); }
    }

    // Actual Pages API ingestion, not a stand-in repository test. Push stays disabled.
    const prefs = await api('/notifications/settings', 'PUT', {
      shiftEndEnabled: true, etaChangeEnabled: true, leftWorkEnabled: true, homeArrivalEnabled: true,
    });
    assert(prefs.status === 200 && prefs.body.settings.leftWorkEnabled,
      label + ' notification settings D1 update');
    const auth = { Authorization: 'Bearer local-integration-only' };
    const eventId = 'phase-g-departure-' + crypto.randomUUID();
    const departed = await api('/presence-events', 'POST',
      { eventId, personId: id, type: 'LEFT_WORK' }, auth);
    assert(departed.status === 202 && departed.body?.event?.queued === true,
      label + ' actual presence API not queued: ' + JSON.stringify(departed));
    const replay = await api('/presence-events', 'POST',
      { eventId, personId: id, type: 'LEFT_WORK' }, auth);
    assert(replay.status === 202 && replay.body?.event?.acceptedAt === departed.body.event.acceptedAt,
      label + ' event receipt replay must retain accepted timestamp');
    const arrivalId = 'phase-g-arrival-' + crypto.randomUUID();
    const arrived = await api('/presence-events', 'POST',
      { eventId: arrivalId, personId: id, type: 'ARRIVED_HOME' }, auth);
    assert(arrived.status === 202 && arrived.body?.event?.queued,
      label + ' arrival event did not queue');
    const evidenceResponse = await fetch(base + '/api/__phase-g-state?personId=' + encodeURIComponent(id),
      { headers: { 'x-phase-g-test-token': 'local-integration-only' } });
    assert(evidenceResponse.ok, label + ' local D1 readback blocked');
    const evidence = await evidenceResponse.json();
    assert(evidence.receipts.filter(r => r.event_id === eventId).length === 1 &&
      evidence.receipts.filter(r => r.event_id === arrivalId).length === 1 &&
      evidence.jobs.filter(j => j.dedupe_key.endsWith(eventId)).length === 1 &&
      evidence.jobs.filter(j => j.dedupe_key.endsWith(arrivalId)).length === 1 &&
      evidence.state.left_work_at === departed.body.event.acceptedAt &&
      evidence.state.arrived_home_at === arrived.body.event.acceptedAt,
      label + ' one D1 did not contain both persisted events, state and outbox jobs');
    assert(evidence.jobs.every(j => j.status === 'pending') && stats.remoteCalls === 0,
      label + ' real delivery or unexpected job status during local acceptance');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-page="TodayPage"]').waitFor();
    assert(errors.length === 0, label + ' browser page errors: ' + errors.join('; '));
    return { engine: label, followup, staffXlsxReview: true, noPreapprovalWrites: true,
      personAndScheduleD1: true, placeTransitRouteD1: true,
      exactRouteTodayEta: true, notificationRulesD1: true,
      presenceReceipts: 2, eventJobs: 2, duplicateEventIdOnce: true,
      localOutboxOnly: true, remotePushCalls: 0, remoteKakaoCalls: 0 };
  } finally {
    await ctx.close(); await browser.close();
  }
}
try {
  await run('npm', ['run', 'build']);
  await run(wrangler, ['d1', 'migrations', 'apply', 'come-back-home-db',
    '--local', '--config', config, '--persist-to', persist]);
  worker = spawn(wrangler, ['dev', '--local', '--config', config,
    '--persist-to', persist, '--port', new URL(base).port,
    '--ip', '127.0.0.1', '--var', 'PRESENCE_EVENT_INGEST_TOKEN:local-integration-only',
    '--show-interactive-dev-session=false', '--log-level', 'warn'],
  { cwd: root, env: { ...process.env, CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.logs = '';
  worker.stdout.on('data', d => { worker.logs += d; });
  worker.stderr.on('data', d => { worker.logs += d; });
  await ready();
  if (process.env.CBH_FOLLOWUP_E2E === '1') {
    process.env.VITE_CBH_RUNTIME = 'api';
    process.env.VITE_CBH_PROVIDER_RUNTIME = 'api';
    const {createServer} = await import('vite');
    referenceServer = await createServer({root,server:{host:'127.0.0.1',port:0,proxy:{'/api':base}},logLevel:'error'});
    await referenceServer.listen();
    referenceBase = 'http://127.0.0.1:' + referenceServer.httpServer.address().port;
  }
  const first = await engineTest(chromium, 'Chromium');
  const second = await engineTest(webkit, 'WebKit');
  console.log('PHASE_G_FULL_NONIMAGE_CHAIN_E2E_PASS=' + JSON.stringify({
    results: [first, second], isolatedD1: true,
    productionWrites: 0, remotePushCalls: 0, liveProviderCalls: 0, realStaffData: 0,
  }));
} finally {
  if (referenceServer) await referenceServer.close();
  if (worker && worker.exitCode == null) {
    worker.kill();
    await new Promise(resolveDone => {
      const t = setTimeout(() => { if (worker.exitCode == null) worker.kill('SIGKILL'); resolveDone(); }, 3000);
      worker.once('exit', () => { clearTimeout(t); resolveDone(); });
    });
  }
  await rm(persist, { recursive: true, force: true });
}
