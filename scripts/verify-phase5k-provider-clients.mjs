import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = async (name) => JSON.parse(await readFile(new URL('../test/fixtures/providers/' + name, import.meta.url), 'utf8'));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const clientsSource = await readFile(new URL('../worker/providers/source-clients.ts', import.meta.url), 'utf8');
const transportSource = await readFile(new URL('../worker/providers/transport.ts', import.meta.url), 'utf8');
for (const source of [clientsSource, transportSource]) {
  expect(!source.includes('fetch('), 'Phase 5K source must not implement fetch');
}
for (const forbidden of ['TEST_SECRET', 'actual-key', 'service-key-value']) {
  expect(!clientsSource.includes(forbidden), 'source client contains secret-like fixture value ' + forbidden);
}

const fixtureByCapability = new Map([
  ['keyword-place-search', await fixture('kakao-place.json')],
  ['public-transit-routing', await fixture('kakao-public-transit.json')],
  ['bus-stop-name-search', await fixture('seoul-bus-stops.json')],
  ['bus-route-all-arrivals', await fixture('seoul-bus-arrivals.json')],
  ['subway-station-name-search', await fixture('seoul-subway-stations.json')],
  ['realtime-subway-arrivals', await fixture('seoul-subway-arrivals.json')],
  ['realtime-subway-position', await fixture('seoul-subway-positions.json')],
]);

const requests = [];
const fakeTransport = {
  async getJson(request, context) {
    requests.push({ request, context });
    if (!fixtureByCapability.has(request.capability)) {
      throw new Error('Fixture missing for ' + request.capability);
    }
    return structuredClone(fixtureByCapability.get(request.capability));
  },
};

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const clients = await vite.ssrLoadModule('/worker/providers/source-clients.ts');

  const kakao = new clients.KakaoMapRequestClient(fakeTransport);
  const places = await kakao.searchPlaces('카카오프렌즈', { x: 127.06, y: 37.51 }, { fetchedAt: '2026-10-05T10:00:00+09:00' });
  const routes = await kakao.publicTransitRoutes(
    { x: 127.11119217, y: 37.39477123 },
    { x: 127.12628814, y: 37.41993056 },
  );
  expect(places[0]?.providerId === '26338954', 'Kakao client did not pass fixture through place mapper');
  expect(routes[0]?.totalMinutes === 15, 'Kakao client did not pass fixture through route mapper');

  const bus = new clients.SeoulBusRequestClient(fakeTransport);
  const stops = await bus.searchStops('강남역', { x: 127.03, y: 37.49 });
  const busArrivals = await bus.arrivals('122000606', '100100118');
  expect(stops[0]?.providerId === '122000606', 'Seoul bus client stop mapping mismatch');
  expect(busArrivals.length === 2, 'Seoul bus route-all stop filter mismatch');

  const subway = new clients.SeoulSubwayRequestClient(fakeTransport);
  const stations = await subway.searchStations('강남', { x: 127.02, y: 37.49 });
  const subwayArrivals = await subway.arrivals('강남', '02호선');
  const positions = await subway.trainPositions('2호선');
  expect(stations[0]?.providerId === '0222', 'Seoul subway station client mismatch');
  expect(subwayArrivals[0]?.providerVehicleId === '2258', 'Seoul subway arrival client mismatch');
  expect(positions[0]?.providerTrainId === '2258', 'Seoul subway position client mismatch');

  const byCapability = new Map(requests.map((entry) => [entry.request.capability, entry.request]));

  const placeRequest = byCapability.get('keyword-place-search');
  expect(placeRequest?.urlTemplate === 'https://dapi.kakao.com/v2/local/search/keyword.json', 'Kakao place URL mismatch');
  expect(placeRequest?.query?.query === '카카오프렌즈', 'Kakao place query mismatch');
  expect(placeRequest?.query?.sort === 'distance', 'Kakao near-search sort mismatch');
  expect(placeRequest?.auth?.secretName === 'KAKAO_REST_API_KEY', 'Kakao secret reference mismatch');
  expect(placeRequest?.auth?.placement === 'header', 'Kakao auth placement mismatch');
  expect(placeRequest?.security === 'TLS_VERIFIED', 'Kakao TLS status mismatch');

  const routeRequest = byCapability.get('public-transit-routing');
  expect(routeRequest?.query?.start_x === '127.11119217', 'Kakao route start_x mismatch');
  expect(routeRequest?.query?.input_coord === 'WGS84', 'Kakao route coordinate contract mismatch');

  const busSearchRequest = byCapability.get('bus-stop-name-search');
  expect(busSearchRequest?.urlTemplate.endsWith('/stationinfo/getStationByName'), 'Seoul bus stop endpoint mismatch');
  expect(busSearchRequest?.query?.stSrch === '강남역', 'Seoul bus stSrch mismatch');
  expect(busSearchRequest?.auth?.secretName === 'SEOUL_BUS_SERVICE_KEY', 'Seoul bus secret reference mismatch');
  expect(busSearchRequest?.security === 'DOCUMENTED_HTTP_REQUIRES_VALIDATION', 'Seoul bus HTTP risk must remain explicit');

  const busArrivalRequest = byCapability.get('bus-route-all-arrivals');
  expect(busArrivalRequest?.urlTemplate.endsWith('/arrive/getArrInfoByRouteAll'), 'Seoul bus route-all endpoint mismatch');
  expect(busArrivalRequest?.query?.busRouteId === '100100118', 'Seoul bus route id mismatch');

  const stationRequest = byCapability.get('subway-station-name-search');
  expect(stationRequest?.pathParams?.stationName === '강남', 'Seoul station path parameter mismatch');
  expect(stationRequest?.auth?.placement === 'path', 'Seoul subway key placement mismatch');
  expect(stationRequest?.auth?.secretName === 'SEOUL_SUBWAY_API_KEY', 'Seoul subway secret reference mismatch');
  expect(stationRequest?.security === 'DOCUMENTED_HTTP_REQUIRES_VALIDATION', 'Seoul subway HTTP risk must remain explicit');

  const arrivalRequest = byCapability.get('realtime-subway-arrivals');
  expect(arrivalRequest?.pathParams?.stationName === '강남', 'Realtime subway must use stationName');

  const positionRequest = byCapability.get('realtime-subway-position');
  expect(positionRequest?.pathParams?.line === '2호선', 'Realtime position line parameter mismatch');
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5K fixture-backed provider request client verification passed');
