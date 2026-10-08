import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = async (name) => JSON.parse(await readFile(new URL('../test/fixtures/providers/' + name, import.meta.url), 'utf8'));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const networkSource = await readFile(new URL('../worker/providers/network-transport.ts', import.meta.url), 'utf8');
const runtimeSource = await readFile(new URL('../worker/providers/runtime.ts', import.meta.url), 'utf8');
const workerApi = await readFile(new URL('../worker/api.ts', import.meta.url), 'utf8');
const pagesEntry = await readFile(new URL('../functions/api/_middleware.ts', import.meta.url), 'utf8');
const localConfig = JSON.parse(await readFile(new URL('../wrangler.local.jsonc', import.meta.url), 'utf8'));

expect(networkSource.includes('class SecureProviderJsonTransport'), 'secure network transport missing');
expect(networkSource.includes('assertProviderActivationReady'), 'security gate is not enforced by network transport');
expect(networkSource.includes('isDocumentedOfficialHttpEndpoint'), 'official Seoul HTTP allowlist assertion missing');
expect(runtimeSource.includes("env.PROVIDER_RUNTIME_ENABLED !== '1'"), 'provider runtime disable gate missing');
expect(pagesEntry.includes('createProviderRuntime'), 'Pages provider runtime wiring missing');
expect(workerApi.includes("providerRuntime.kakao.searchPlaces"), 'Kakao place Pages wiring missing');
expect(workerApi.includes("providerRuntime.kakao.publicTransitRoutes"), 'Kakao route Pages wiring missing');
expect(workerApi.includes('providerRuntime.seoulBus.arrivals'), 'Seoul bus runtime path missing');
expect(workerApi.includes('providerRuntime.seoulSubway.arrivals'), 'Seoul subway runtime path missing');
expect(localConfig.vars?.PROVIDER_RUNTIME_ENABLED === '0', 'local provider runtime must remain disabled');

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const network = await vite.ssrLoadModule('/worker/providers/network-transport.ts');
  const runtime = await vite.ssrLoadModule('/worker/providers/runtime.ts');

  const calls = [];
  const placeFixture = await fixture('kakao-place.json');
  const routeFixture = await fixture('kakao-public-transit.json');
  const busFixture = await fixture('seoul-bus-stops.json');
  const subwayStationFixture = await fixture('seoul-subway-stations.json');
  const subwayFixture = await fixture('seoul-subway-arrivals.json');
  const addressQuery = '서울특별시 문성로32길 20-4';
  const addressFixture = {
    meta: { total_count: 1, pageable_count: 1, is_end: true },
    documents: [{
      address_name: '서울 관악구 문성로32길 20-4',
      address_type: 'ROAD_ADDR',
      x: '126.915',
      y: '37.475',
      address: {
        address_name: '서울 관악구 신림동 000-0',
        x: '126.915',
        y: '37.475',
      },
      road_address: {
        address_name: '서울 관악구 문성로32길 20-4',
        building_name: '',
        x: '126.915',
        y: '37.475',
      },
    }],
  };
  const fakeFetch = async (input, init) => {
    calls.push({ input, init });
    const url = new URL(String(input));
    let body = placeFixture;
    if (url.hostname === 'ws.bus.go.kr') {
      body = busFixture;
    } else if (url.hostname === 'openapi.seoul.go.kr') {
      body = subwayStationFixture;
    } else if (url.hostname === 'swopenapi.seoul.go.kr') {
      body = subwayFixture;
    } else if (url.pathname === '/v2/routing/publictraffic') {
      body = routeFixture;
    } else if (url.pathname === '/v2/local/search/address.json') {
      body = addressFixture;
    } else if (
      url.pathname === '/v2/local/search/keyword.json' &&
      url.searchParams.get('query') === addressQuery
    ) {
      body = { meta: { total_count: 0, pageable_count: 0, is_end: true }, documents: [] };
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const disabledRuntime = runtime.createProviderRuntime({
    PROVIDER_RUNTIME_ENABLED: '0',
    DB: {},
  }, fakeFetch);
  expect(disabledRuntime === null, 'disabled provider runtime must not construct source bundle');
  expect(calls.length === 0, 'disabled provider runtime must not issue fetch');

  const fakeSecretValue = 'fixture-not-a-real-provider-key';
  const enabledRuntime = runtime.createProviderRuntime({
    PROVIDER_RUNTIME_ENABLED: '1',
    KAKAO_REST_API_KEY: fakeSecretValue,
    SEOUL_BUS_SERVICE_KEY: 'fixture-bus-key',
    SEOUL_OPENAPI_KEY: 'fixture-openapi-key',
    SEOUL_SUBWAY_API_KEY: 'fixture-subway-key',
    DB: {},
  }, fakeFetch);
  expect(enabledRuntime !== null, 'enabled fixture runtime did not construct');

  const places = await enabledRuntime.kakao.searchPlaces('카카오프렌즈', { x: 127.06, y: 37.51 });
  const addressPlaces = await enabledRuntime.kakao.searchPlaces(addressQuery);
  const routes = await enabledRuntime.kakao.publicTransitRoutes(
    { x: 127.11119217, y: 37.39477123 },
    { x: 127.12628814, y: 37.41993056 },
  );
  expect(places[0]?.providerId === '26338954', 'Kakao place network transport mapping mismatch');
  expect(addressPlaces.length === 1, 'Kakao address fallback must return an address result');
  expect(addressPlaces[0]?.providerId?.startsWith('kakao-address:'), 'Kakao address fallback provider id mismatch');
  expect(addressPlaces[0]?.roadAddress === '서울 관악구 문성로32길 20-4', 'Kakao address fallback road address mismatch');
  expect(routes[0]?.totalMinutes === 15, 'Kakao route network transport mapping mismatch');
  expect(calls.length === 4, 'Kakao fake fetch call count mismatch');

  const fallbackKeywordUrl = new URL(calls[1].input);
  const fallbackAddressUrl = new URL(calls[2].input);
  expect(fallbackKeywordUrl.pathname === '/v2/local/search/keyword.json', 'address fallback must try keyword search first');
  expect(fallbackAddressUrl.pathname === '/v2/local/search/address.json', 'empty keyword result must fall back to address search');
  expect(fallbackAddressUrl.searchParams.get('query') === addressQuery, 'Kakao address fallback query mismatch');
  const fallbackAuthorization = new Headers(calls[2].init?.headers).get('Authorization');
  expect(fallbackAuthorization === 'KakaoAK ' + fakeSecretValue, 'Kakao address fallback Authorization mismatch');

  const placeCall = calls[0];
  const placeUrl = new URL(placeCall.input);
  expect(placeUrl.protocol === 'https:', 'Kakao materialized URL must stay HTTPS');
  expect(placeUrl.searchParams.get('query') === '카카오프렌즈', 'Kakao materialized query mismatch');
  const authorization = new Headers(placeCall.init?.headers).get('Authorization');
  expect(authorization === 'KakaoAK ' + fakeSecretValue, 'Kakao Authorization materialization mismatch');

  const seoulFetchCount = calls.length;
  const seoulStops = await enabledRuntime.seoulBus.searchStops('강남역', { x: 127.03, y: 37.49 });
  const subwayStations = await enabledRuntime.seoulSubway.searchStations('강남');
  const subwayArrivals = await enabledRuntime.seoulSubway.arrivals('강남', '02호선');
  expect(seoulStops[0]?.providerId === '122000606', 'Seoul bus official HTTP transport mapping mismatch');
  expect(subwayStations[0]?.providerId === '0222', 'Seoul subway station lookup mapping mismatch');
  expect(subwayArrivals[0]?.providerVehicleId === '2258', 'Seoul subway official HTTP transport mapping mismatch');
  expect(calls.length === seoulFetchCount + 3, 'Seoul official provider calls must reach fake transport');
  const busUrl = new URL(calls[seoulFetchCount].input);
  const stationUrl = new URL(calls[seoulFetchCount + 1].input);
  const subwayUrl = new URL(calls[seoulFetchCount + 2].input);
  expect(busUrl.protocol === 'http:' && busUrl.hostname === 'ws.bus.go.kr', 'Seoul bus official HTTP allowlist URL mismatch');
  expect(stationUrl.protocol === 'http:' && stationUrl.hostname === 'openapi.seoul.go.kr', 'Seoul station-search official HTTP allowlist URL mismatch');
  expect(subwayUrl.protocol === 'http:' && subwayUrl.hostname === 'swopenapi.seoul.go.kr', 'Seoul subway official HTTP allowlist URL mismatch');
  expect(busUrl.searchParams.get('serviceKey') === 'fixture-bus-key', 'Seoul bus service key materialization mismatch');
  expect(stationUrl.pathname.includes('fixture-openapi-key'), 'Seoul station search must materialize the general Open Data key');
  expect(!stationUrl.pathname.includes('fixture-subway-key'), 'Realtime subway key leaked into general station lookup');
  expect(subwayUrl.pathname.includes('fixture-subway-key'), 'Seoul realtime subway path key materialization mismatch');
  expect(!subwayUrl.pathname.includes('fixture-openapi-key'), 'General Seoul Open Data key leaked into realtime subway request');

  const noSecretTransport = new network.SecureProviderJsonTransport(
    fakeFetch,
    new network.ObjectProviderSecretResolver({}),
  );
  let missingSecret = '';
  try {
    await noSecretTransport.getJson({
      source: 'kakao-map',
      capability: 'keyword-place-search',
      method: 'GET',
      urlTemplate: 'https://dapi.kakao.com/v2/local/search/keyword.json',
      query: { query: 'test' },
      auth: {
        secretName: 'KAKAO_REST_API_KEY',
        placement: 'header',
        target: 'Authorization',
        prefix: 'KakaoAK ',
      },
      security: 'TLS_VERIFIED',
    });
  } catch (error) {
    missingSecret = error instanceof Error ? error.message : String(error);
  }
  expect(missingSecret === 'Provider activation blocked: MISSING_SECRET', 'missing-secret transport block mismatch');

  let sanitizedError = '';
  const failingFetch = async () => new Response('provider-secret-must-not-leak', { status: 429 });
  const failingTransport = new network.SecureProviderJsonTransport(
    failingFetch,
    new network.ObjectProviderSecretResolver({ KAKAO_REST_API_KEY: fakeSecretValue }),
  );
  try {
    await failingTransport.getJson({
      source: 'kakao-map',
      capability: 'keyword-place-search',
      method: 'GET',
      urlTemplate: 'https://dapi.kakao.com/v2/local/search/keyword.json',
      query: { query: 'test' },
      auth: {
        secretName: 'KAKAO_REST_API_KEY',
        placement: 'header',
        target: 'Authorization',
        prefix: 'KakaoAK ',
      },
      security: 'TLS_VERIFIED',
    });
  } catch (error) {
    sanitizedError = error instanceof Error ? error.message : String(error);
  }
  expect(sanitizedError === 'Provider request failed: kakao-map/keyword-place-search HTTP 429', 'provider error sanitization mismatch');
  expect(!sanitizedError.includes(fakeSecretValue), 'provider error leaked secret');
  // Kakao routing often returns HTTP 400 with numeric code -10 for a quota
  // denial. Preserve only the trusted number, not the private message/body.
  const routingFail = new network.SecureProviderJsonTransport(
    async () => Response.json({
      errorType: 'BadRequest', code: -10,
      message: 'secret-private-user-coordinate-must-not-leak',
    }, { status: 400 }),
    new network.ObjectProviderSecretResolver({ KAKAO_REST_API_KEY: fakeSecretValue }),
  );
  let routingError = '';
  try {
    await routingFail.getJson({
      source: 'kakao-map', capability: 'public-transit-routing', method: 'GET',
      urlTemplate: 'https://dapi.kakao.com/v2/routing/publictraffic',
      query: { start_x: '127', start_y: '37.5', end_x: '127.1', end_y: '37.6' },
      auth: {
        secretName: 'KAKAO_REST_API_KEY', placement: 'header',
        target: 'Authorization', prefix: 'KakaoAK ',
      },
      security: 'TLS_VERIFIED',
    });
  } catch (error) {
    routingError = error instanceof Error ? error.message : String(error);
  }
  expect(routingError === 'Provider request failed: kakao-map/public-transit-routing HTTP 400 CODE -10',
    'numeric Kakao quota code must be retained with no upstream response text');
  expect(!routingError.includes('secret-private') && !routingError.includes(fakeSecretValue),
    'private provider content leaked into a route failure');

} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5M provider network transport verification passed');
