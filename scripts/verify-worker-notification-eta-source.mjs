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
  const etaModule = await vite.ssrLoadModule('/worker/notification-eta-source.ts');

  const schedules = {
    async getByDate(personId, date) {
      if (personId !== 'person-1' || date !== '2026-10-06') return null;
      return {
        id: 'schedule-1',
        personId,
        date,
        enabled: true,
        start: '14:00',
        end: '22:00',
      };
    },
    async list() { return []; },
    async upsert() {},
    async upsertMany() {},
  };
  const places = {
    async get(personId, kind) {
      if (personId !== 'person-1') return null;
      return {
        id: kind + '-1',
        personId,
        kind,
        label: kind,
        address: { road: 'fixture' },
        coordinate: kind === 'origin'
          ? { x: 127.0, y: 37.5 }
          : { x: 126.9, y: 37.4 },
      };
    },
    async save() {},
  };
  const commute = {
    async getPreferredRouteCandidateId() { return 'route-preferred'; },
    async listAccessPoints() { return []; },
    async upsertAccessPoint() {},
    async setAccessPointSelected() {},
    async setAccessPointAlias() {},
    async setSelectedBusRoute() {},
    async getRoutePreference() { return null; },
    async saveRoutePreference() {},
    async listRouteCandidates() { return []; },
    async setPreferredRouteCandidateId() {},
  };
  let routeCalls = 0;
  const providers = {
    kakao: {
      async searchPlaces() { return []; },
      async publicTransitRoutes(_origin, _destination, context) {
        routeCalls += 1;
        expect(context?.fetchedAt === '2026-10-06T12:00:00.000Z', 'provider context timestamp mismatch');
        return [
          { id: 'route-fast', totalMinutes: 25, transferCount: 2, walkMinutes: 5 },
          { id: 'route-preferred', totalMinutes: 40, transferCount: 1, walkMinutes: 3 },
        ];
      },
    },
    seoulBus: { async searchStops() { return []; }, async arrivals() { return []; } },
    seoulSubway: {
      async searchStations() { return []; },
      async arrivals() { return []; },
      async trainPositions() { return []; },
    },
  };

  const source = new etaModule.ProviderNotificationEtaSource({
    schedules,
    places,
    commute,
    providers,
  });

  const beforeShiftEnd = await source.get('person-1', new Date('2026-10-06T12:00:00.000Z'));
  expect(beforeShiftEnd?.arrivalAt === '2026-10-06T13:40:00.000Z', 'ETA must depart from scheduled 22:00 KST before shift end');
  expect(beforeShiftEnd?.confidence === 'FALLBACK', 'route-only ETA must stay FALLBACK');
  expect(routeCalls === 1, 'provider route should be called once');

  commute.getPreferredRouteCandidateId = async () => 'missing-route';
  const afterShiftEnd = await source.get('person-1', new Date('2026-10-06T14:00:00.000Z'));
  expect(afterShiftEnd?.arrivalAt === '2026-10-06T14:25:00.000Z', 'missing preferred route must deterministically choose fastest route after shift end');

  const noCoordinates = new etaModule.ProviderNotificationEtaSource({
    schedules,
    commute,
    providers,
    places: { ...places, async get(_personId, kind) { return kind === 'origin' ? await places.get('person-1', kind) : null; } },
  });
  const unknown = await noCoordinates.get('person-1', new Date('2026-10-06T12:00:00.000Z'));
  expect(unknown?.arrivalAt == null && unknown?.confidence === 'UNKNOWN', 'missing place geometry must fail closed to UNKNOWN');

  const failingProvider = new etaModule.ProviderNotificationEtaSource({
    schedules,
    places,
    commute,
    providers: {
      ...providers,
      kakao: {
        ...providers.kakao,
        async publicTransitRoutes() { throw new Error('provider unavailable'); },
      },
    },
  });
  const failed = await failingProvider.get('person-1', new Date('2026-10-06T12:00:00.000Z'));
  expect(failed?.arrivalAt == null && failed?.confidence === 'UNKNOWN', 'provider failure must fail closed to UNKNOWN');
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Worker provider-backed notification ETA source verification passed');
