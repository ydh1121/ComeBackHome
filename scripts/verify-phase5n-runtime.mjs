import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

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

  const clock = {
    now: () => new Date('2026-10-05T12:00:00.000Z'),
  };
  const bus = {
    async arrivals() {
      return [
        {
          providerVehicleId: 'fixture-bus',
          minutes: 2,
          observedAt: '2026-10-05T20:59:00+09:00',
        },
      ];
    },
  };
  const subway = {
    async arrivals() {
      return [];
    },
  };
  const freshnessPolicy = {
    classify(observedAt, now) {
      return (now.getTime() - Date.parse(observedAt)) <= 2 * 60_000 ? 'LIVE' : 'STALE';
    },
  };

  const today = new runtime.ProviderTodayRepository(
    schedules,
    commute,
    bus,
    subway,
    clock,
    freshnessPolicy,
  );
  const snapshot = await today.get('mock-person-1');
  expect(snapshot?.routeCandidateId === 'provider-route-fast', 'Today preferred provider route mismatch');
  expect(snapshot?.shiftEnd === '22:10', 'Today shift-end mapping mismatch');
  expect(snapshot?.eta.status === 'LIVE', 'injected freshness policy did not promote LIVE');
  expect(snapshot?.eta.freshnessMinutes === 1, 'realtime freshness calculation mismatch');
  expect(snapshot?.eta.arrivalTime === '22:48', 'fallback ETA calculation mismatch');
  expect(snapshot?.eta.calculatedAt === '2026-10-05T12:00:00.000Z', 'ETA calculatedAt clock mismatch');

  const failingBus = {
    async arrivals() {
      throw new Error('fixture provider unavailable');
    },
  };
  const fallbackToday = new runtime.ProviderTodayRepository(
    schedules,
    commute,
    failingBus,
    subway,
    clock,
  );
  const fallback = await fallbackToday.get('mock-person-1');
  expect(fallback?.eta.status === 'FALLBACK', 'missing freshness policy/provider failure must remain FALLBACK');
  expect(fallback?.eta.arrivalTime === '22:48', 'provider failure must preserve route-based ETA');

  const noRouteCommute = new runtime.ProviderCommuteRepository(
    persistedCommute,
    places,
    { async search() { return []; } },
  );
  const unknownToday = new runtime.ProviderTodayRepository(
    schedules,
    noRouteCommute,
    bus,
    subway,
    clock,
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
