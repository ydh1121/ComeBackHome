import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const configPath = resolve(root, 'wrangler.local.jsonc');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const wranglerCommand = resolve(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
);
const port = Number(process.env.CBH_PHASE5G_PORT ?? '8799');
const origin = 'http://127.0.0.1:' + port;
const persistPath = await mkdtemp(join(tmpdir(), 'comebackhome-phase5g-'));

let workerProcess;
let vite;
const originalFetch = globalThis.fetch;
const originalLocalStorage = globalThis.localStorage;

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...options.env },
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: false,
    });
    let output = '';

    if (options.capture) {
      child.stdout.on('data', (chunk) => { output += chunk.toString(); });
      child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    }

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise({ output });
        return;
      }
      reject(new Error(
        command + ' ' + args.join(' ') + ' failed with code ' + code +
        (signal ? ' signal ' + signal : '') +
        (output ? '\n' + output : ''),
      ));
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function requestJson(path, init) {
  const response = await originalFetch(origin + path, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(path + ' failed with HTTP ' + response.status + ': ' + JSON.stringify(payload));
  }
  return payload;
}

async function waitForWorker() {
  const deadline = Date.now() + 30_000;
  let lastError;

  while (Date.now() < deadline) {
    if (workerProcess?.exitCode != null) {
      throw new Error('wrangler dev exited before becoming ready.\n' + (workerProcess.phase5gOutput ?? ''));
    }
    try {
      const health = await requestJson('/api/health');
      if (health?.ok === true) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }

  throw new Error('local Worker did not become ready: ' + String(lastError ?? 'timeout'));
}

function installBrowserRuntimeBridge() {
  const storage = new Map();
  globalThis.localStorage = {
    get length() { return storage.size; },
    clear() { storage.clear(); },
    getItem(key) { return storage.has(String(key)) ? storage.get(String(key)) : null; },
    key(index) { return Array.from(storage.keys())[index] ?? null; },
    removeItem(key) { storage.delete(String(key)); },
    setItem(key, value) { storage.set(String(key), String(value)); },
  };

  globalThis.fetch = (input, init) => {
    if (typeof input === 'string' && input.startsWith('/')) {
      return originalFetch(origin + input, init);
    }
    if (input instanceof URL && input.pathname.startsWith('/') && input.origin === 'null') {
      return originalFetch(origin + input.pathname + input.search, init);
    }
    return originalFetch(input, init);
  };
}

async function stopWorker() {
  if (!workerProcess || workerProcess.exitCode != null) return;
  workerProcess.kill();
  await new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      if (workerProcess.exitCode == null) workerProcess.kill('SIGKILL');
      resolvePromise();
    }, 3_000);
    workerProcess.once('exit', () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
}

try {
  await access(wranglerCommand);

  await run(npmCommand, ['run', 'build'], {
    env: { VITE_CBH_RUNTIME: 'api', VITE_CBH_PROVIDER_RUNTIME: 'mock' },
  });

  await run(wranglerCommand, [
    'd1',
    'migrations',
    'apply',
    'come-back-home-db',
    '--local',
    '--config',
    configPath,
    '--persist-to',
    persistPath,
  ], {
    env: { CI: '1' },
  });

  workerProcess = spawn(wranglerCommand, [
    'dev',
    '--local',
    '--config',
    configPath,
    '--persist-to',
    persistPath,
    '--port',
    String(port),
    '--ip',
    '127.0.0.1',
    '--show-interactive-dev-session=false',
    '--log-level',
    'warn',
  ], {
    cwd: root,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  workerProcess.phase5gOutput = '';
  workerProcess.stdout.on('data', (chunk) => { workerProcess.phase5gOutput += chunk.toString(); });
  workerProcess.stderr.on('data', (chunk) => { workerProcess.phase5gOutput += chunk.toString(); });

  await waitForWorker();

  const initialBootstrap = await requestJson('/api/bootstrap');
  assert(Array.isArray(initialBootstrap.people), 'bootstrap people must be an array');
  assert(initialBootstrap.productTimezone === 'Asia/Seoul', 'bootstrap product timezone mismatch');

  const providerStatus = await requestJson('/api/providers/status');
  assert(providerStatus.enabled === false, 'local provider runtime must remain disabled');
  assert(providerStatus.source === 'unconfigured', 'disabled provider status source mismatch');

  for (const path of [
    '/api/providers/place-search?q=phase5h',
    '/api/providers/transit-search?q=phase5h&x=127&y=37.5',
    '/api/providers/routes?originX=127&originY=37.5&destinationX=126.9&destinationY=37.4',
    '/api/providers/bus-arrivals?stopProviderId=stop&routeProviderId=route',
    '/api/providers/subway-arrivals?providerStationId=station&line=2',
  ]) {
    const disabledProviderResponse = await originalFetch(origin + path);
    const disabledProviderPayload = await disabledProviderResponse.json();
    assert(disabledProviderResponse.status === 503, 'disabled provider endpoint must fail with HTTP 503: ' + path);
    assert(disabledProviderPayload?.error === 'Provider runtime is disabled.', 'disabled provider error contract mismatch: ' + path);
  }

  const created = await requestJson('/api/people', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Phase 5G Local', relation: 'QA' }),
  });
  const personId = created?.person?.id;
  assert(typeof personId === 'string' && personId.length > 0, 'person creation did not return an id');

  installBrowserRuntimeBridge();
  vite = await createViteServer({
    root,
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true },
  });
  const composition = await vite.ssrLoadModule('/src/app/composition.ts');
  const services = await composition.createHybridApiApplicationServices('mock');

  let invalidProviderCombinationBlocked = false;
  try {
    await composition.createApplicationServices('mock', 'api');
  } catch (error) {
    invalidProviderCombinationBlocked = error instanceof Error &&
      error.message === 'Provider API runtime requires VITE_CBH_RUNTIME=api.';
  }
  assert(invalidProviderCombinationBlocked, 'provider API mode must require API persistence runtime');

  const httpClientModule = await vite.ssrLoadModule('/src/providers/http/HttpJsonClient.ts');
  const httpProvidersModule = await vite.ssrLoadModule('/src/providers/http/HttpDataProviders.ts');
  const providerClient = new httpClientModule.HttpJsonClient('/api');
  const placeProvider = new httpProvidersModule.HttpPlaceSearchProvider(providerClient);
  let providerTransportBlocked = false;
  try {
    await placeProvider.search('phase5h');
  } catch (error) {
    providerTransportBlocked = error instanceof Error && error.message === 'Provider runtime is disabled.';
  }
  assert(providerTransportBlocked, 'same-origin provider transport must fail closed while Worker provider runtime is disabled');

  assert(services.runtime.mode === 'hybrid-api', 'hybrid mode metadata mismatch');
  assert(services.runtime.persistence === 'worker-api', 'hybrid persistence metadata mismatch');
  assert(services.runtime.providerData === 'mock', 'hybrid provider metadata mismatch');
  assert(services.actions.personSelection.getSelectedPersonId() === personId, 'API bootstrap did not select the first persisted person');

  const people = await services.repositories.people.list();
  assert(people.some((person) => person.id === personId), 'HttpPersonRepository did not read persisted person');

  const schedules = [
    {
      id: 'phase5g-schedule-1',
      personId,
      date: '2099-01-02',
      enabled: true,
      start: '09:00',
      end: '18:00',
    },
    {
      id: 'phase5g-schedule-2',
      personId,
      date: '2099-01-03',
      enabled: true,
      start: '10:00',
      end: '19:00',
    },
  ];
  await services.repositories.schedules.upsertMany(schedules);
  const savedSchedule = await services.repositories.schedules.getByDate(personId, '2099-01-02');
  assert(savedSchedule?.id === 'phase5g-schedule-1', 'schedule batch round-trip failed');

  await services.repositories.places.save({
    id: 'phase5g-origin',
    personId,
    kind: 'origin',
    label: 'Phase 5G Office',
    address: { road: 'Local Test Road 1' },
    coordinate: { x: 126.98, y: 37.56 },
    providerPlaceId: 'phase5g-origin-provider',
  });
  await services.repositories.places.save({
    id: 'phase5g-destination',
    personId,
    kind: 'destination',
    label: 'Phase 5G Home',
    address: { road: 'Local Test Road 2' },
    coordinate: { x: 126.97, y: 37.55 },
    providerPlaceId: 'phase5g-destination-provider',
  });
  const originPlace = await services.repositories.places.get(personId, 'origin');
  assert(originPlace?.label === 'Phase 5G Office', 'origin place round-trip failed');

  const accessPoint = {
    id: 'phase5g-access-origin',
    personId,
    placeKind: 'origin',
    providerId: 'phase5g-stop-1',
    mode: 'BUS',
    name: 'Phase 5G Stop',
    selected: true,
    displayCode: 'LOCAL',
    userLabel: 'Local stop',
  };
  await services.repositories.commute.upsertAccessPoint(accessPoint);
  await services.repositories.commute.setAccessPointAlias(accessPoint.id, 'Local stop renamed');
  const accessPoints = await services.repositories.commute.listAccessPoints(personId, 'origin');
  assert(accessPoints.some((point) => point.id === accessPoint.id && point.userLabel === 'Local stop renamed'), 'commute access round-trip failed');

  await services.repositories.commute.saveRoutePreference({
    id: 'route-pref:' + personId,
    personId,
    originPlaceKind: 'origin',
    destinationPlaceKind: 'destination',
    viaAccessPointIds: [accessPoint.id],
  });
  const routePreference = await services.repositories.commute.getRoutePreference(personId);
  assert(routePreference?.viaAccessPointIds?.[0] === accessPoint.id, 'commute preference round-trip failed');

  await services.repositories.commute.setPreferredRouteCandidateId(personId, 'phase5g-runtime-candidate');
  const preferredRouteCandidateId = await services.repositories.commute.getPreferredRouteCandidateId(personId);
  assert(preferredRouteCandidateId === 'phase5g-runtime-candidate', 'preferred route persistence failed');
  const runtimeCandidates = await services.repositories.commute.listRouteCandidates(personId);
  assert(Array.isArray(runtimeCandidates), 'route candidates must remain runtime-provider data');

  await services.repositories.notifications.setRules({ shiftEnd: false, etaChange: true });
  await services.repositories.notifications.setPermission('granted');
  const notificationSettings = await services.repositories.notifications.getSettings();
  assert(notificationSettings.rules.shiftEnd === false, 'notification shift-end rule round-trip failed');
  assert(notificationSettings.rules.etaChange === true, 'notification ETA rule round-trip failed');
  assert(notificationSettings.permission === 'granted', 'browser notification permission must remain local runtime state');

  let importBlocked = false;
  try {
    await services.actions.commitImportReview.execute();
  } catch (error) {
    importBlocked = error instanceof Error &&
      error.message === 'Import commit is disabled in hybrid API mode until a real import parser is connected.';
  }
  assert(importBlocked, 'hybrid API import safety gate did not block mock-backed import commit');

  const finalBootstrap = await requestJson('/api/bootstrap');
  assert(finalBootstrap.people.some((person) => person.id === personId), 'bootstrap did not expose persisted person after mutations');
  assert(finalBootstrap.notificationSettings?.etaChangeEnabled === true, 'bootstrap notification state did not reflect D1 mutation');

  const appResponse = await originalFetch(origin + '/');
  const appHtml = await appResponse.text();
  assert(appResponse.ok, 'Workers Static Assets root request failed');
  assert(appHtml.includes('id="root"'), 'Workers Static Assets did not serve the built React shell');

  console.log(JSON.stringify({
    phase: '5G',
    result: 'PASS',
    runtime: services.runtime,
    persistence: 'local-d1',
    remoteResources: 0,
    checks: [
      'dependency-backed api-mode build',
      'local D1 migration apply',
      'local Worker health/bootstrap',
      'hybrid application composition',
      'people repository',
      'schedule batch round-trip',
      'place round-trip',
      'commute persistence/runtime split',
      'notification persisted/local split',
      'hybrid import commit safety gate',
      'Workers Static Assets SPA shell',
      'provider runtime status disabled by default',
      'provider API mode requires API persistence runtime',
      'same-origin provider transport fail-closed boundary',
      'route and realtime provider endpoints fail closed by default',
    ],
  }, null, 2));
} finally {
  if (vite) await vite.close();
  await stopWorker();
  globalThis.fetch = originalFetch;
  if (originalLocalStorage === undefined) {
    delete globalThis.localStorage;
  } else {
    globalThis.localStorage = originalLocalStorage;
  }
  await rm(persistPath, { recursive: true, force: true });
}
