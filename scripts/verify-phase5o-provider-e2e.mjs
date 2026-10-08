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

const originalFetch = globalThis.fetch;

try {
  const workerApi = await vite.ssrLoadModule('/worker/api.ts');
  const clientModule = await vite.ssrLoadModule('/src/providers/http/HttpJsonClient.ts');
  const providerModule = await vite.ssrLoadModule('/src/providers/http/HttpDataProviders.ts');
  const runtimeModule = await vite.ssrLoadModule('/src/providers/runtime/ProviderRuntimeRepositories.ts');
  const mocks = await vite.ssrLoadModule('/src/mocks/repositories.ts');
  const stateModule = await vite.ssrLoadModule('/src/mocks/state.ts');

  const calls = {
    place: 0,
    route: 0,
    transit: 0,
    bus: 0,
    subway: 0,
  };

  const providerRuntime = {
    kakao: {
      async searchPlaces(query, near) {
        calls.place += 1;
        return [{
          providerId: 'e2e-place-1',
          placeName: query,
          roadAddress: '서울 테스트로 1',
          coordinate: near ?? { x: 127, y: 37.5 },
          category: query === '버스정류장' ? '교통,수송 > 버스정류장' :
            query === '지하철역' ? '교통,수송 > 지하철역' : '음식점 > 일반음식점',
        }];
      },
      async publicTransitRoutes() {
        calls.route += 1;
        return [
          {
            id: 'e2e-route-slower',
            totalMinutes: 45,
            transferCount: 1,
            walkMinutes: 4,
            fare: 1450,
            steps: [{ type: 'SUBWAY', label: 'fixture slower' }],
          },
          {
            id: 'e2e-route-fast',
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
    },
    seoulBus: {
      async nearbyStops(near) {
        return [
          { id: 'seoul-bus:near', providerId: 'near', mode: 'BUS',
            name: '근처 공식 정류장', displayCode: '23813',
            coordinate: { x: near.x + 0.001, y: near.y } },
          { id: 'seoul-bus:far', providerId: 'far', mode: 'BUS',
            name: '세종대왕기념관', displayCode: '99999',
            coordinate: { x: near.x + 0.105, y: near.y } },
        ];
      },
      async searchStops() {
        calls.transit += 1;
        return [];
      },
      async arrivals() {
        calls.bus += 1;
        return [{
          providerVehicleId: 'e2e-bus',
          minutes: 5,
          observedAt: '2026-10-05T13:15:00.000Z',
        }];
      },
    },
    seoulSubway: {
      async searchStations(query) {
        calls.transit += 1;
        return [{
          id: 'seoul-subway:0222',
          providerId: '0222',
          mode: 'SUBWAY',
          name: query === '강남' ? '강남' : query,
          line: '02호선',
          selected: false,
        }];
      },
      async arrivals() {
        calls.subway += 1;
        return [{
          providerVehicleId: 'e2e-subway',
          minutes: 4,
          observedAt: '2026-10-05T13:15:00.000Z',
        }];
      },
      async trainPositions() {
        calls.subway += 1;
        return [];
      },
    },
  };

  let providerEnabled = true;
  const env = {
    DB: {},
    VITE_CBH_KAKAO_JAVASCRIPT_KEY: 'fixture-public-kakao-js-key',
    get PROVIDER_RUNTIME_ENABLED() {
      return providerEnabled ? '1' : '0';
    },
  };

  const clientConfigResponse = await workerApi.handleApiRequest(
    new Request('https://local.test/api/client-config'),
    env,
    providerRuntime,
  );
  const clientConfigBody = await clientConfigResponse.json();
  expect(clientConfigResponse.ok, 'client config endpoint failed');
  expect(clientConfigBody?.kakaoMaps?.configured === true, 'Kakao Maps client config must report configured');
  expect(
    clientConfigBody?.kakaoMaps?.javaScriptKey === 'fixture-public-kakao-js-key',
    'Kakao Maps public client key mapping mismatch',
  );

  const fallbackConfigResponse = await workerApi.handleApiRequest(
    new Request('https://local.test/api/client-config'),
    {
      ...env,
      VITE_CBH_KAKAO_JAVASCRIPT_KEY: undefined,
      KAKAO_JAVASCRIPT_KEY: 'fixture-public-browser-app-key',
    },
    providerRuntime,
  );
  const fallbackConfigBody = await fallbackConfigResponse.json();
  expect(fallbackConfigResponse.ok && fallbackConfigBody?.kakaoMaps?.configured === true,
    'runtime-only Maps JS app-key binding must work without a build key');
  expect(fallbackConfigBody?.kakaoMaps?.javaScriptKey === 'fixture-public-browser-app-key',
    'Maps JS app key fallback must never substitute the Kakao REST secret');

  globalThis.fetch = async (input, init) => {
    if (typeof input !== 'string' || !input.startsWith('/api')) {
      throw new Error('Unexpected external fetch in Phase5O harness: ' + String(input));
    }
    const request = new Request('https://local.test' + input, init);
    return workerApi.handleApiRequest(
      request,
      env,
      providerEnabled ? providerRuntime : null,
    );
  };

  const client = new clientModule.HttpJsonClient('/api');
  const placeProvider = new providerModule.HttpPlaceSearchProvider(client);
  const routeProvider = new providerModule.HttpTransitRouteProvider(client);
  const transitProvider = new providerModule.HttpTransitAccessSearchProvider(client);
  const busProvider = new providerModule.HttpRealtimeBusProvider(client);
  const subwayProvider = new providerModule.HttpRealtimeSubwayProvider(client);

  const placeResults = await placeProvider.search('fixture place');
  expect(placeResults[0]?.providerId === 'e2e-place-1', 'place client -> Worker -> fake provider mapping failed');
  expect(calls.place === 1, 'Kakao place fake source call count mismatch');

  const routeResults = await routeProvider.search(
    { x: 127.0, y: 37.5 },
    { x: 126.9, y: 37.4 },
  );
  expect(routeResults.length === 2, 'route client -> Worker -> fake provider count mismatch');
  expect(routeResults[1]?.id === 'e2e-route-fast', 'route response order unexpectedly changed at Worker boundary');
  expect(calls.route === 1, 'Kakao route fake source call count mismatch');

  const transitResults = await transitProvider.search('강남역', { x: 127.03, y: 37.49 });
  expect(transitResults.length === 1, 'official transit station search result count mismatch');
  expect(transitResults[0]?.mode === 'SUBWAY', 'official transit station must retain its mode');
  expect(transitResults[0]?.providerId === '0222', 'official transit source identity mismatch');
  expect(transitResults[0]?.coordinate == null, 'missing official station coordinates must not be fabricated');

  const kakaoCallsBeforeStationSearch = calls.place;
  const onlyTransit = await transitProvider.search('언주역', { x: 127.03, y: 37.49 });
  expect(onlyTransit.every((item) => item.mode === 'BUS' || item.mode === 'SUBWAY'),
    'transit search must only return official stops and stations');
  expect(calls.place === kakaoCallsBeforeStationSearch,
    'transit search must not call general-purpose Kakao POI search');

  const nearbyTransit = await transitProvider.nearby({ x: 127.03, y: 37.49 });
  expect(nearbyTransit.some((item) => item.mode === 'BUS'), 'nearby transit must include bus candidates');
  expect(nearbyTransit.some((item) => item.providerId === 'near' && item.displayCode === '23813'),
    'official bus identity and ARS number must be preserved');
  expect(!nearbyTransit.some((item) => item.providerId === 'far'),
    '9-km bus candidate must never leak into nearby list');
  expect(nearbyTransit.every((item) => item.distanceM <= (item.mode === 'BUS' ? 800 : 900)),
    'normal nearby transit must be capped to walkable distances');
  expect(nearbyTransit.every((item, i) => i === 0 || nearbyTransit[i - 1].distanceM <= item.distanceM),
    'nearby transit must be distance ascending');
  expect(nearbyTransit.some((item) => item.mode === 'SUBWAY'), 'nearby transit must include subway candidates');

  const subwayResolveUrl = new URL('https://local.test/api/providers/transit-resolve');
  subwayResolveUrl.searchParams.set('mode', 'SUBWAY');
  subwayResolveUrl.searchParams.set('name', '강남역');
  subwayResolveUrl.searchParams.set('line', '2호선');
  subwayResolveUrl.searchParams.set('x', '127.03');
  subwayResolveUrl.searchParams.set('y', '37.49');
  const subwayResolveResponse = await workerApi.handleApiRequest(
    new Request(subwayResolveUrl.toString()),
    env,
    providerRuntime,
  );
  const subwayResolveBody = await subwayResolveResponse.json();
  expect(subwayResolveResponse.ok, 'subway station resolution endpoint failed');
  expect(
    subwayResolveBody?.resolved?.providerId === '0222',
    'exact subway station without provider coordinate must remain resolvable',
  );

  const busArrivals = await busProvider.arrivals('122000606', '100100118');
  expect(busArrivals[0]?.providerVehicleId === 'e2e-bus', 'bus realtime client -> Worker -> Seoul source mapping failed');
  expect(calls.bus === 1, 'Seoul bus fake source call count mismatch');

  const transitCallsBeforeSubwayRealtime = calls.transit;
  const subwayArrivals = await subwayProvider.arrivals('0222', '강남', '02호선');
  expect(subwayArrivals[0]?.providerVehicleId === 'e2e-subway', 'subway realtime client -> Worker -> Seoul source mapping failed');
  expect(calls.transit === transitCallsBeforeSubwayRealtime + 1, 'subway realtime must resolve the persisted provider station ID first');
  expect(calls.subway === 1, 'Seoul subway fake source call count mismatch');

  const subwayCallsBeforeMismatch = calls.subway;
  const mismatchedSubway = await subwayProvider.arrivals('9999', '강남', '02호선');
  expect(mismatchedSubway.length === 0, 'mismatched persisted subway station ID must fail closed to no realtime evidence');
  expect(calls.subway === subwayCallsBeforeMismatch, 'mismatched station ID must not reach realtime arrival source');

  const store = new stateModule.MockStateStore(structuredClone(stateModule.MOCK_FIXTURE));
  const places = new mocks.MockPlaceRepository(store);
  const schedules = new mocks.MockScheduleRepository(store);
  const persistedCommute = new mocks.MockCommuteRepository(store);
  const presence = new mocks.MockPresenceRepository();
  await persistedCommute.setPreferredRouteCandidateId('mock-person-1', 'e2e-route-fast');

  const commute = new runtimeModule.ProviderCommuteRepository(
    persistedCommute,
    places,
    routeProvider,
  );
  const candidates = await commute.listRouteCandidates('mock-person-1');
  expect(candidates[0]?.id === 'e2e-route-fast', 'provider-backed commute did not rank Worker route result');
  expect(candidates[0]?.personId === 'mock-person-1', 'provider-backed commute lost person ownership');

  const realtimeCallsBeforeToday = { bus: calls.bus, subway: calls.subway };
  const today = new runtimeModule.ProviderTodayRepository(
    schedules,
    commute,
    presence,
    busProvider,
    subwayProvider,
    { now: () => new Date('2026-10-05T12:00:00.000Z') },
  );
  const snapshot = await today.get('mock-person-1');
  expect(snapshot?.routeCandidateId === 'e2e-route-fast', 'Today E2E preferred route mismatch');
  expect(snapshot?.eta.status === 'FALLBACK', 'future scheduled departure must use route-based FALLBACK');
  expect(snapshot?.eta.arrivalTime === '22:48', 'Today E2E route-based fallback ETA mismatch');
  expect(
    calls.bus === realtimeCallsBeforeToday.bus && calls.subway === realtimeCallsBeforeToday.subway,
    'future scheduled departure must not query realtime arrivals too early',
  );

  providerEnabled = false;
  let disabledError = '';
  try {
    await placeProvider.search('disabled');
  } catch (error) {
    disabledError = error instanceof Error ? error.message : String(error);
  }
  expect(disabledError === 'Provider runtime is disabled.', 'disabled Worker provider contract mismatch');
  expect(calls.place === 2, 'disabled Worker provider call reached fake Kakao source');
} finally {
  globalThis.fetch = originalFetch;
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5O provider API in-process E2E verification passed');
