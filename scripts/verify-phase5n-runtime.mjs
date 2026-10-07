import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const read = async (path) => (await import('node:fs/promises')).readFile(new URL(path, import.meta.url), 'utf8');
const compositionSource = await read('../src/app/composition.ts');
const runtimeSource = await read('../src/providers/runtime/ProviderRuntimeRepositories.ts');

for (const text of [
  'new HttpTransitRouteProvider(client)',
  'new HttpRealtimeBusProvider(client)',
  'new HttpRealtimeSubwayProvider(client)',
  'new ProviderCommuteRepository(persistedCommute, places, routeProvider)',
  'new ProviderTodayRepository(',
]) {
  expect(compositionSource.includes(text), 'Phase5N composition missing ' + text);
}
expect(runtimeSource.includes("status: 'UNKNOWN'"), 'UNKNOWN ETA boundary missing');
expect(runtimeSource.includes("status: 'ACTUAL'"), 'ACTUAL arrival boundary missing');
expect(runtimeSource.includes('calculateArrivalEta'), 'realtime ETA overlay calculator missing');
expect(!runtimeSource.includes('fetch('), 'application provider runtime must not perform network fetch directly');

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const runtime = await vite.ssrLoadModule('/src/providers/runtime/ProviderRuntimeRepositories.ts');
  const mocks = await vite.ssrLoadModule('/src/mocks/repositories.ts');
  const stateModule = await vite.ssrLoadModule('/src/mocks/state.ts');

  const store = new stateModule.MockStateStore(structuredClone(stateModule.MOCK_FIXTURE));
  const places = new mocks.MockPlaceRepository(store);
  const schedules = new mocks.MockScheduleRepository(store);
  const persistedCommute = new mocks.MockCommuteRepository(store);
  const presence = new mocks.MockPresenceRepository();

  const routeProvider = {
    async search() {
      return [
        {
          id: 'provider-route-slower',
          totalMinutes: 45,
          transferCount: 1,
          walkMinutes: 4,
          fare: 1450,
          steps: [{ type: 'SUBWAY', label: 'fixture slower' }],
        },
        {
          id: 'provider-route-fast',
          totalMinutes: 38,
          transferCount: 2,
          walkMinutes: 7,
          accessMinutes: 3,
          egressMinutes: 4,
          fare: 1550,
          steps: [
            { type: 'WALKING', label: 'fixture walk' },
            { type: 'BUS', label: 'fixture bus' },
            { type: 'SUBWAY', label: 'fixture subway' },
          ],
        },
      ];
    },
  };

  const commute = new runtime.ProviderCommuteRepository(
    persistedCommute,
    places,
    routeProvider,
  );

  const routes = await commute.listRouteCandidates('mock-person-1');
  expect(routes.length === 2, 'provider route count mismatch');
  expect(routes[0]?.id === 'provider-route-fast', 'provider routes must be deterministically ranked');
  expect(routes[0]?.personId === 'mock-person-1', 'person ownership must be attached in runtime repository');
  expect(routes[0]?.walkMinutes === 7, 'provider walkMinutes mapping mismatch');

  await persistedCommute.setPreferredRouteCandidateId('mock-person-1', 'provider-route-fast');

  const subway = {
    async arrivals() {
      return [];
    },
  };

  const scheduledClock = {
    now: () => new Date('2026-10-05T12:00:00.000Z'),
  };
  const scheduledToday = new runtime.ProviderTodayRepository(
    schedules,
    commute,
    presence,
    { async arrivals() { return []; } },
    subway,
    scheduledClock,
  );
  const scheduled = await scheduledToday.get('mock-person-1');
  expect(scheduled?.routeCandidateId === 'provider-route-fast', 'Today preferred provider route mismatch');
  expect(scheduled?.shiftEnd === '22:10', 'Today shift-end mapping mismatch');
  expect(scheduled?.eta.status === 'FALLBACK', 'future scheduled departure must remain route-based FALLBACK');
  expect(scheduled?.eta.arrivalTime === '22:48', 'scheduled route ETA mismatch');
  expect(scheduled?.eta.calculatedAt === '2026-10-05T12:00:00.000Z', 'ETA calculatedAt clock mismatch');

  await presence.record({
    eventId: 'left-work-runtime-001',
    personId: 'mock-person-1',
    type: 'LEFT_WORK',
    acceptedAt: '2026-10-05T13:15:00.000Z',
    workDate: '2026-10-05',
  });

  const liveClock = {
    now: () => new Date('2026-10-05T13:16:00.000Z'),
  };
  const liveBus = {
    async arrivals() {
      return [{
        providerVehicleId: 'fixture-bus',
        minutes: 5,
        observedAt: '2026-10-05T13:15:00.000Z',
      }];
    },
  };
  const liveToday = new runtime.ProviderTodayRepository(
    schedules,
    commute,
    presence,
    liveBus,
    subway,
    liveClock,
  );
  const live = await liveToday.get('mock-person-1');
  expect(live?.leftWorkAt === '2026-10-05T13:15:00.000Z', 'actual LEFT_WORK state missing from Today');
  expect(live?.eta.status === 'LIVE', 'fresh realtime arrival must promote LIVE ETA');
  expect(live?.eta.freshnessMinutes === 1, 'realtime freshness calculation mismatch');
  expect(live?.eta.arrivalTime === '22:55', 'realtime wait overlay ETA mismatch');

  const failingBus = {
    async arrivals() {
      throw new Error('fixture provider unavailable');
    },
  };
  const fallbackToday = new runtime.ProviderTodayRepository(
    schedules,
    commute,
    presence,
    failingBus,
    subway,
    liveClock,
  );
  const fallback = await fallbackToday.get('mock-person-1');
  expect(fallback?.eta.status === 'FALLBACK', 'provider failure must remain FALLBACK');
  expect(fallback?.eta.arrivalTime === '22:53', 'provider failure must preserve actual-departure route ETA');

  await presence.record({
    eventId: 'arrived-home-runtime-001',
    personId: 'mock-person-1',
    type: 'ARRIVED_HOME',
    acceptedAt: '2026-10-05T14:01:00.000Z',
    workDate: '2026-10-05',
  });
  const arrived = await liveToday.get('mock-person-1');
  expect(arrived?.eta.status === 'ACTUAL', 'ARRIVED_HOME must promote ACTUAL state');
  expect(arrived?.eta.arrivalTime === '23:01', 'actual home arrival time mismatch');
  expect(arrived?.arrivedHomeAt === '2026-10-05T14:01:00.000Z', 'actual ARRIVED_HOME state missing');

  const noRouteCommute = new runtime.ProviderCommuteRepository(
    persistedCommute,
    places,
    { async search() { return []; } },
  );
  const emptyPresence = new mocks.MockPresenceRepository();
  const unknownToday = new runtime.ProviderTodayRepository(
    schedules,
    noRouteCommute,
    emptyPresence,
    liveBus,
    subway,
    scheduledClock,
  );
  const unknown = await unknownToday.get('mock-person-1');
  expect(unknown?.eta.status === 'UNKNOWN', 'missing route must produce UNKNOWN ETA');
  expect(unknown?.eta.arrivalTime == null, 'UNKNOWN ETA must not fabricate arrivalTime');
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('phase 5N provider-backed commute/ETA runtime verification passed');
