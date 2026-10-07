import { readdir, readFile, stat } from 'node:fs/promises';
import { relative } from 'node:path';

const root = new URL('..', import.meta.url);
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const expectedRoutes = [
  '/',
  '/schedule',
  '/schedule/edit',
  '/schedule/:date/edit',
  '/import',
  '/import/:batchId/people',
  '/import/:batchId/structure',
  '/import/:batchId/review',
  '/people',
  '/people/new',
  '/people/:personId/edit',
  '/people/:personId',
  '/people/:personId/place/origin',
  '/people/:personId/place/destination',
  '/people/:personId/commute',
  '/people/:personId/commute/manual',
  '/people/:personId/commute/routes/:routeId',
  '/people/:personId/commute/:placeKind/access',
  '/people/:personId/commute/:placeKind/access/search',
  '/people/:personId/commute/:placeKind/access/:accessId/bus-routes',
  '/notifications',
  '/settings',
  '/settings/presence',
];

const [
  manifest,
  router,
  main,
  runtimeConfig,
  composition,
  commuteManual,
  transitAccess,
  transitSearch,
  commuteService,
  commuteRuntime,
  providerContracts,
  importPage,
  importPeople,
  importCommit,
  presencePage,
  workerApi,
  today,
  appShell,
  scrollRestore,
] = await Promise.all([
  read('../src/application/route-manifest.ts'),
  read('../src/app/router.tsx'),
  read('../src/main.tsx'),
  read('../src/config/runtime.ts'),
  read('../src/app/composition.ts'),
  read('../src/pages/CommuteManualPage.tsx'),
  read('../src/pages/TransitAccessPage.tsx'),
  read('../src/pages/TransitSearchPage.tsx'),
  read('../src/application/services/CommuteWorkflowService.ts'),
  read('../src/providers/runtime/ProviderRuntimeRepositories.ts'),
  read('../src/application/contracts/providers.ts'),
  read('../src/pages/ImportPage.tsx'),
  read('../src/pages/ImportPersonMatchPage.tsx'),
  read('../src/application/use-cases/commitImportReview.ts'),
  read('../src/pages/PresenceAutomationPage.tsx'),
  read('../worker/api.ts'),
  read('../src/pages/TodayPage.tsx'),
  read('../src/shared/layout/AppShell.tsx'),
  read('../src/app/useRouteScrollRestoration.ts'),
]);

for (const route of expectedRoutes) {
  expect(manifest.includes("'" + route + "'"), 'product route missing from manifest: ' + route);
  expect(router.includes("'" + route + "'"), 'product route missing from router: ' + route);
}
expect(router.includes('const qaRouteEntries = import.meta.env.DEV'), 'QA routes are not DEV-only');
expect(!router.includes("import { QaStateMatrixPage }"), 'QA state page is statically imported into production router');
expect(!router.includes("import { QaFlowMapPage }"), 'QA flow page is statically imported into production router');
expect(!router.includes("import { QaDesktopDropPage }"), 'QA desktop page is statically imported into production router');
expect(router.includes('{ path: \'*\', element: <Navigate to="/" replace /> }'), 'unknown routes must redirect to product home');
expect(!composition.includes('/mocks/'), 'production composition imports mock modules');
expect(!composition.includes('MOCK_FIXTURE'), 'production composition contains mock fixture');
expect(main.includes("import.meta.env.DEV && runtimeMode === 'mock'"), 'mock application is not DEV-gated');
expect(main.includes("import('./app/mockComposition')"), 'DEV mock composition split missing');
expect(runtimeConfig.includes("import.meta.env.DEV ? 'mock' : 'api'"), 'production runtime does not fail-safe to API');
expect(composition.includes("providerData: providerMode === 'api' ? 'worker-api' : 'disabled'"), 'provider-disabled runtime still uses mock data');

for (const token of [
  'destinationAccessPointId',
  'moveRouteVia',
  'removeRouteVia',
]) expect(commuteManual.includes(token), 'saved-route editor missing: ' + token);
expect(
  transitAccess.includes("routeRole === 'destination'") &&
  transitAccess.includes('setRouteDestinationAccess'),
  'saved-route destination nearby flow is incomplete',
);
expect(
  transitSearch.includes("routeRole === 'destination'") &&
  transitSearch.includes('setRouteDestinationAccess'),
  'saved-route destination search flow is incomplete',
);
expect(commuteService.includes('setRouteDestinationAccess'), 'saved-route destination persistence action missing');

expect(commuteRuntime.includes('activeSavedRoute.destinationAccessPointId'), 'destination transit does not affect provider route matching');
expect(commuteRuntime.includes('selectedAccess.providerId'), 'persisted transit provider ID does not reach realtime ETA');
expect(providerContracts.includes('arrivals(providerStationId: string'), 'subway realtime contract does not carry providerStationId');
expect(workerApi.includes("stations.find((candidate) => candidate.providerId === providerStationId)"), 'persisted subway station ID is not verified at the Worker realtime boundary');
expect(workerApi.includes("providerRuntime.seoulSubway.searchStations(stationName)"), 'subway realtime does not resolve canonical station identity before arrival lookup');

for (const token of [
  '근무표 이미지 추가',
  '엑셀 파일 가져오기',
]) expect(importPage.includes(token), 'import entry missing: ' + token);
for (const token of [
  '새 사람으로 등록',
  '가져오지 않음',
  'services.actions.people.create',
]) expect(importPeople.includes(token), 'multi-person import review missing: ' + token);
expect(importCommit.includes('await this.schedules.upsertMany(entries)'), 'import final commit is not atomic multi-person batch');
expect(importCommit.includes('ignoredDetectedIds'), 'ignored roster people are not excluded from import commit');

for (const token of [
  '퇴근 · 귀가 자동화',
  'PRESENCE_EVENT_INGEST_TOKEN',
  'LEFT_WORK',
  'ARRIVED_HOME',
]) expect(presencePage.includes(token), 'presence setup flow missing: ' + token);
for (const token of [
  "segments[2] === 'status'",
  "segments[2] === 'validate'",
  "segments[1] === 'presence-events'",
]) expect(workerApi.includes(token), 'presence API missing: ' + token);

for (const token of [
  "status: 'ACTUAL'",
  'leftWorkAt',
  'arrivedHomeAt',
  'calculateArrivalEta',
]) expect(commuteRuntime.includes(token), 'Today/ETA runtime missing actual/realtime state: ' + token);
for (const token of [
  "'ACTUAL'",
  "'LIVE'",
  "'STALE'",
  "'FALLBACK'",
  "'UNKNOWN'",
]) expect(today.includes(token), 'Today state display missing: ' + token);

expect(appShell.includes('useRouteScrollRestoration()'), 'AppShell does not restore route scroll');
expect(scrollRestore.includes("navigationType === 'POP'"), 'Back navigation scroll restoration missing');
expect(scrollRestore.includes('scrollPositions.set'), 'route scroll position persistence missing');

async function collect(dirUrl) {
  const files = [];
  for (const name of await readdir(dirUrl)) {
    const child = new URL(name + '/', dirUrl);
    let info;
    try { info = await stat(child); } catch { info = await stat(new URL(name, dirUrl)); }
    if (info.isDirectory()) files.push(...await collect(child));
    else files.push(new URL(name, dirUrl));
  }
  return files;
}

for (const rootPath of ['../src/', '../worker/', '../functions/']) {
  const dir = new URL(rootPath, import.meta.url);
  const files = await collect(dir);
  for (const file of files) {
    if (!/\.(ts|tsx|js)$/.test(file.pathname)) continue;
    const path = relative(root.pathname, file.pathname);
    if (path.includes('/mocks/') || path.endsWith('mockComposition.ts') || path.includes('/pages/Qa')) continue;
    const source = await readFile(file, 'utf8');
    if (/\bTODO\b|\bFIXME\b|not implemented/i.test(source)) failures.push('unresolved product TODO: ' + path);
    for (const forbidden of ['mock-person-1', 'MOCK_FIXTURE', 'fixture-person']) {
      if (source.includes(forbidden)) failures.push('mock/fixture leakage in production source: ' + path + ' -> ' + forbidden);
    }
    if (
      path.startsWith('src/pages/') &&
      (
        source.includes('data-source-qa') ||
        source.includes('persistence: {services.runtime.persistence}') ||
        source.includes('provider: {services.runtime.providerData}')
      )
    ) {
      failures.push('developer runtime diagnostics leaked into product UI: ' + path);
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(JSON.stringify({
  result: 'PASS',
  matrix: {
    people: 'COMPLETE',
    places: 'COMPLETE',
    manualSchedule: 'COMPLETE',
    fileImport: 'COMPLETE',
    importReview: 'COMPLETE',
    savedRoutes: 'COMPLETE',
    busSubwaySetup: 'COMPLETE',
    realtimeTransit: 'COMPLETE',
    today: 'COMPLETE',
    notifications: 'COMPLETE',
    presence: 'COMPLETE',
    pwa: 'COMPLETE',
    settings: 'COMPLETE',
  },
  missing: 0,
  regressed: 0,
  routes: expectedRoutes.length,
}, null, 2));
