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

const busXmlByCapability = new Map([
  ['bus-stop-name-search', `<?xml version="1.0" encoding="UTF-8"?>
<ServiceResult>
  <msgHeader><headerCd>0</headerCd><headerMsg>정상 처리되었습니다.</headerMsg></msgHeader>
  <msgBody>
    <itemList>
      <arsId>23813</arsId>
      <stId>122000606</stId>
      <stNm><![CDATA[강남역]]></stNm>
      <tmX>127.0300921798</tmX>
      <tmY>37.4985037086</tmY>
      <dist>153</dist>
    </itemList>
  </msgBody>
</ServiceResult>`],
  ['bus-routes-by-stop', `<?xml version="1.0" encoding="UTF-8"?>
<ServiceResult>
  <msgHeader><headerCd>0</headerCd><headerMsg>정상 처리되었습니다.</headerMsg></msgHeader>
  <msgBody>
    <itemList>
      <busRouteId>100100118</busRouteId>
      <busRouteNm>146</busRouteNm>
      <stBegin>상계주공7단지</stBegin>
      <stEnd>강남역</stEnd>
      <routeType>3</routeType>
    </itemList>
  </msgBody>
</ServiceResult>`],
  ['bus-route-all-arrivals', `<?xml version="1.0" encoding="UTF-8"?>
<ServiceResult>
  <msgHeader><headerCd>0</headerCd><headerMsg>정상 처리되었습니다.</headerMsg></msgHeader>
  <msgBody>
    <itemList>
      <busRouteId>100100118</busRouteId>
      <rtNm>146</rtNm>
      <mkTm>2026-10-05 09:45:00</mkTm>
      <exps1>90</exps1>
      <plainNo1><![CDATA[서울74사1234]]></plainNo1>
      <exps2>280</exps2>
      <plainNo2><![CDATA[서울74사5678]]></plainNo2>
      <stId>122000606</stId>
    </itemList>
  </msgBody>
</ServiceResult>`],
]);

const requests = [];
const fakeTransport = {
  async getText(request, context) {
    requests.push({ request, context });
    if (!busXmlByCapability.has(request.capability)) {
      throw new Error('XML fixture missing for ' + request.capability);
    }
    return busXmlByCapability.get(request.capability);
  },
  async getJson(request, context) {
    requests.push({ request, context });
    if (!fixtureByCapability.has(request.capability)) {
      throw new Error('Fixture missing for ' + request.capability);
    }
    if (
      request.capability === 'subway-station-name-search' &&
      request.pathParams?.stationName === '강남역'
    ) {
      return {
        SearchInfoBySubwayNameService: {
          list_total_count: 0,
          RESULT: { CODE: 'INFO-000', MESSAGE: '정상 처리되었습니다' },
          row: [],
        },
      };
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
  const busRoutes = await bus.routesByStop('23813');
  const busArrivals = await bus.arrivals('122000606', '100100118');
  expect(stops[0]?.providerId === '122000606', 'Seoul bus client XML stop mapping mismatch');
  expect(stops[0]?.name === '강남역', 'Seoul bus CDATA decoding mismatch');
  expect(stops[0]?.coordinate?.x === 127.0300921798, 'Seoul bus client tmX mapping mismatch');
  expect(stops[0]?.coordinate?.y === 37.4985037086, 'Seoul bus client tmY mapping mismatch');
  expect(busRoutes[0]?.providerRouteId === '100100118', 'Seoul bus XML route mapping mismatch');
  expect(busRoutes[0]?.routeNo === '146', 'Seoul bus XML route number mismatch');
  expect(busArrivals.length === 2, 'Seoul bus XML route-all stop filter mismatch');

  const subway = new clients.SeoulSubwayRequestClient(fakeTransport);
  const stations = await subway.searchStations('강남역', { x: 127.02, y: 37.49 });
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

  const busRoutesRequest = byCapability.get('bus-routes-by-stop');
  expect(busRoutesRequest?.urlTemplate.endsWith('/stationinfo/getRouteByStation'), 'Seoul bus routes-by-stop endpoint mismatch');
  expect(busRoutesRequest?.query?.arsId === '23813', 'Seoul bus routes-by-stop arsId mismatch');
  expect(busRoutesRequest?.query?.resultType == null, 'Seoul bus routes-by-stop must not send undocumented resultType');

  const busArrivalRequest = byCapability.get('bus-route-all-arrivals');
  expect(busArrivalRequest?.urlTemplate.endsWith('/arrive/getArrInfoByRouteAll'), 'Seoul bus route-all endpoint mismatch');
  expect(busArrivalRequest?.query?.busRouteId === '100100118', 'Seoul bus route id mismatch');
  expect(busArrivalRequest?.query?.resultType == null, 'Seoul bus arrival must use the documented XML contract');

  const stationRequest = byCapability.get('subway-station-name-search');
  expect(stationRequest?.pathParams?.stationName === '강남', 'Seoul station fallback path parameter mismatch');
  const stationRequests = requests.filter((entry) => entry.request.capability === 'subway-station-name-search');
  expect(stationRequests.length === 2, 'Seoul station search should retry once after an empty 역-suffixed query');
  expect(stationRequests[0]?.request?.pathParams?.stationName === '강남역', 'Seoul station primary query must preserve user input');
  expect(stationRequest?.auth?.placement === 'path', 'Seoul subway station key placement mismatch');
  expect(stationRequest?.auth?.secretName === 'SEOUL_OPENAPI_KEY', 'Seoul subway station lookup must use the general Seoul Open Data key');
  expect(stationRequest?.auth?.target === '{SEOUL_OPENAPI_KEY}', 'Seoul subway station key token mismatch');
  expect(stationRequest?.security === 'DOCUMENTED_HTTP_REQUIRES_VALIDATION', 'Seoul subway HTTP risk must remain explicit');

  const arrivalRequest = byCapability.get('realtime-subway-arrivals');
  expect(arrivalRequest?.pathParams?.stationName === '강남', 'Realtime subway must use stationName');
  expect(arrivalRequest?.auth?.secretName === 'SEOUL_SUBWAY_API_KEY', 'Realtime subway arrival must use the dedicated realtime key');
  expect(arrivalRequest?.auth?.target === '{SEOUL_SUBWAY_API_KEY}', 'Realtime subway arrival key token mismatch');

  const positionRequest = byCapability.get('realtime-subway-position');
  expect(positionRequest?.pathParams?.line === '2호선', 'Realtime position line parameter mismatch');
  expect(positionRequest?.auth?.secretName === 'SEOUL_SUBWAY_API_KEY', 'Realtime subway position must use the dedicated realtime key');
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5K fixture-backed provider request client verification passed');
