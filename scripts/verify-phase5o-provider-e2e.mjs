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

  // If the official Seoul stop endpoint is unavailable, only a verified
  // local BUS category may appear as a limited UI fallback.
  const originalNearbyStops = providerRuntime.seoulBus.nearbyStops;
  providerRuntime.seoulBus.nearbyStops = async () => {
    throw new Error('fixture positional API unavailable');
  };
  const fallbackUrl = new URL('https://local.test/api/providers/transit-nearby');
  fallbackUrl.searchParams.set('x', '127.03');
  fallbackUrl.searchParams.set('y', '37.49');
  const fallbackResponse = await workerApi.handleApiRequest(
    new Request(fallbackUrl), env, providerRuntime,
  );
  const fallbackBody = await fallbackResponse.json();
  expect(fallbackResponse.ok && fallbackBody?.sourceStatus?.bus === 'VERIFIED_CATEGORY_FALLBACK',
    'strict local bus category fallback must be explicit when official bus is unavailable');
  expect(fallbackBody.results.some((item) =>
    item.mode === 'BUS' && item.id.startsWith('kakao-transit:bus:')),
    'nearby transit must retain a strictly-categorized bus when official source fails');
  expect(fallbackBody.results.every((item) =>
    item.distanceM <= (item.mode === 'BUS' ? 800 : 900)),
    'fallback bus must never reintroduce distant results');
  providerRuntime.seoulBus.nearbyStops = originalNearbyStops;

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

  // Regression matrix for the real route-discovery algorithm. These use the
  // production repository class and fake transport; they never access D1.
  const homeOrigin = { x: 126.9, y: 37.5 };
  const homeDestination = { x: 127.3, y: 37.6 };
  const originA = { x: 127.01, y: 37.5 };
  const originB = { x: 127.02, y: 37.5 };
  const destinationA = { x: 127.11, y: 37.6 };
  const destinationB = { x: 127.12, y: 37.6 };
  const point = (id, kind, coordinate, selected = true) => ({
    id, personId: 'mock-person-1', providerId: id, placeKind: kind,
    name: id, mode: 'SUBWAY', coordinate, selected,
  });
  const O1 = point('O1', 'origin', originA);
  const O2 = point('O2', 'origin', originB);
  const D1 = point('D1', 'destination', destinationA);
  const D2 = point('D2', 'destination', destinationB);
  const saved = (originAccessPointIds = [], destinationAccessPointIds = []) => ({
    id: 'saved-fixture', personId: 'mock-person-1', position: 1, label: '경로 1',
    originAccessPointIds, destinationAccessPointIds, viaAccessPointIds: [], active: true,
  });
  const fixtureRoute = (id, minutes = 30) => ({
    id, totalMinutes: minutes, transferCount: 1, walkMinutes: 4,
    steps: [{ type: 'SUBWAY', label: 'test line' }],
  });
  const caseRepo = ({ originPoints = [], destinationPoints = [], savedRoutes = [],
    search, originCoordinate = homeOrigin, destinationCoordinate = homeDestination,
    preferred = null }) => {
    const persisted = {
      listSavedRoutes: async () => savedRoutes,
      listAccessPoints: async (_id, kind) => kind === 'origin' ? originPoints : destinationPoints,
      getPreferredRouteCandidateId: async () => preferred,
    };
    const placeRepo = {
      get: async (_id, kind) => ({
        coordinate: kind === 'origin' ? originCoordinate : destinationCoordinate,
      }),
    };
    return new runtimeModule.ProviderCommuteRepository(persisted, placeRepo, { search });
  };
  const isPlacePair = (o, d) => o.x === homeOrigin.x && d.x === homeDestination.x;

  // 1: No selections -> ordinary place-to-place search.
  let repoCase = caseRepo({ search: async (o, d) =>
    isPlacePair(o, d) ? [fixtureRoute('base')] : [] });
  let discovery = await repoCase.inspectRouteCandidates('mock-person-1');
  expect(discovery.candidates.length === 1 && discovery.diagnostics.searchPairCount === 1 &&
    discovery.diagnostics.pairs[0]?.originSource === 'PLACE',
    'CASE1 zero selection must search bare saved places');

  // 2: Both selected, provider returns valid selected-pair routes.
  repoCase = caseRepo({ originPoints: [O1], destinationPoints: [D1],
    search: async (o, d) => o.x === originA.x && d.x === destinationA.x
      ? [fixtureRoute('selected')] : [] });
  discovery = await repoCase.inspectRouteCandidates('mock-person-1');
  expect(discovery.candidates[0]?.id === 'selected' &&
    discovery.candidates[0]?.preferenceMatchScore === 0.95 &&
    discovery.diagnostics.placeFallbackUsed === false &&
    discovery.diagnostics.searchPairCount === 1,
    'CASE2 selected pair must rank and avoid unnecessary fallback');

  // 3: N x N selected cartesian product, four independent provider requests.
  repoCase = caseRepo({ originPoints: [O1, O2], destinationPoints: [D1, D2],
    search: async (o, d) => [fixtureRoute('pair:' + o.x + ':' + d.x)] });
  discovery = await repoCase.inspectRouteCandidates('mock-person-1');
  expect(discovery.candidates.length === 4 &&
    discovery.diagnostics.searchPairCount === 4 &&
    discovery.diagnostics.successfulPairCount === 4,
    'CASE3 multi-access origin x destination must search every pair');

  // 4: Partial provider errors cannot discard successful selected results.
  repoCase = caseRepo({ originPoints: [O1, O2], destinationPoints: [D1],
    search: async (o) => {
      if (o.x === originA.x) throw new Error('HTTP request failed with status 429.');
      return [fixtureRoute('survivor')];
    } });
  discovery = await repoCase.inspectRouteCandidates('mock-person-1');
  expect(discovery.candidates[0]?.id === 'survivor' &&
    discovery.diagnostics.failedPairCount === 1 &&
    discovery.diagnostics.successfulPairCount === 1 &&
    discovery.diagnostics.placeFallbackUsed === false,
    'CASE4 keep good selected routes when a different pair fails');

  // 5: Selected pairs all return zero -> fallback to saved place coordinates.
  repoCase = caseRepo({ originPoints: [O1], destinationPoints: [D1],
    search: async (o, d) => isPlacePair(o, d) ? [fixtureRoute('fallback')] : [] });
  discovery = await repoCase.inspectRouteCandidates('mock-person-1');
  expect(discovery.candidates[0]?.id === 'fallback' &&
    discovery.candidates[0]?.preferenceMatchScore == null &&
    discovery.diagnostics.placeFallbackUsed &&
    discovery.diagnostics.searchPairCount === 2,
    'CASE5 all-selected-empty must use place fallback without false match label');

  // 6: An unresolved saved access ID cannot shadow a valid standalone selection.
  repoCase = caseRepo({ originPoints: [O1], destinationPoints: [D1],
    savedRoutes: [saved(['deleted-origin'], ['deleted-destination'])],
    search: async (o, d) => o.x === originA.x && d.x === destinationA.x
      ? [fixtureRoute('fresh-selection')] : [] });
  discovery = await repoCase.inspectRouteCandidates('mock-person-1');
  expect(discovery.candidates[0]?.id === 'fresh-selection' &&
    discovery.diagnostics.staleAccessIdCount === 2 &&
    discovery.diagnostics.pairs[0]?.originSource === 'SELECTED_ACCESS',
    'CASE6 stale route IDs must resolve to fresh standalone selected points');

  // 7: Stale preferred route does not remove candidates, while Today stays UNKNOWN.
  repoCase = caseRepo({ preferred: 'obsolete-candidate',
    search: async () => [fixtureRoute('available')] });
  discovery = await repoCase.inspectRouteCandidates('mock-person-1');
  expect(discovery.candidates.length === 1, 'CASE7 stale preferred ID cannot suppress discovery');
  const staleToday = new runtimeModule.ProviderTodayRepository(
    schedules, repoCase, presence, busProvider, subwayProvider,
    { now: () => new Date('2026-10-05T12:00:00.000Z') },
  );
  const staleSnapshot = await staleToday.get('mock-person-1');
  expect(staleSnapshot?.eta.status === 'UNKNOWN' && !staleSnapshot?.routeCandidateId,
    'CASE7 exact stale preferred route must still fail closed in Today');

  // 8: All pairs fail -> provider error, never a false NO_RESULT.
  repoCase = caseRepo({ originPoints: [O1], destinationPoints: [D1],
    search: async () => { throw new Error('HTTP request failed with status 503.'); } });
  discovery = await repoCase.inspectRouteCandidates('mock-person-1');
  expect(discovery.candidates.length === 0 &&
    discovery.diagnostics.status === 'PROVIDER_ERROR' &&
    discovery.diagnostics.failedPairCount === 2 &&
    discovery.diagnostics.pairs.every((pair) => pair.errorCategory === 'HTTP'),
    'CASE8 provider failure must remain distinguishable after place fallback');

  // 9: Reversed/invalid WGS84 access point coordinates fail safely to place.
  repoCase = caseRepo({ originPoints: [point('invalid', 'origin', { x: 37.5, y: 127 })],
    destinationPoints: [D1],
    search: async (o, d) => isPlacePair(o, d) ? [fixtureRoute('valid-base')] : [] });
  discovery = await repoCase.inspectRouteCandidates('mock-person-1');
  expect(discovery.candidates[0]?.id === 'valid-base' &&
    discovery.diagnostics.placeFallbackUsed,
    'CASE9 swapped access coordinates must not poison fallback');
  repoCase = caseRepo({ originCoordinate: { x: 0, y: 0 },
    search: async () => [fixtureRoute('never')] });
  discovery = await repoCase.inspectRouteCandidates('mock-person-1');
  expect(discovery.candidates.length === 0 &&
    discovery.diagnostics.status === 'INVALID_COORDINATE' &&
    discovery.diagnostics.searchPairCount === 0,
    'CASE9 invalid saved place coordinate must not call provider');

  // 10: Route-specific resolved points override standalone selected sets.
  repoCase = caseRepo({ originPoints: [O1, O2], destinationPoints: [D1, D2],
    savedRoutes: [saved(['O2'], ['D2'])],
    search: async (o, d) => o.x === originB.x && d.x === destinationB.x
      ? [fixtureRoute('route-specific')] : [] });
  discovery = await repoCase.inspectRouteCandidates('mock-person-1');
  expect(discovery.candidates[0]?.id === 'route-specific' &&
    discovery.candidates[0]?.preferenceMatchScore === 1 &&
    discovery.diagnostics.searchPairCount === 1 &&
    discovery.diagnostics.pairs[0]?.originSource === 'ROUTE_ACCESS',
    'CASE10 resolved route-specific selection must take precedence');

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
  expect(calls.place === 5, 'disabled Worker provider call reached fake Kakao source');
} finally {
  globalThis.fetch = originalFetch;
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5O provider API in-process E2E verification passed');
