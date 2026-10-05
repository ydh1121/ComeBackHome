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
const workerIndex = await readFile(new URL('../worker/index.ts', import.meta.url), 'utf8');
const localConfig = JSON.parse(await readFile(new URL('../wrangler.local.jsonc', import.meta.url), 'utf8'));

expect(networkSource.includes('class SecureProviderJsonTransport'), 'secure network transport missing');
expect(networkSource.includes('assertProviderActivationReady'), 'security gate is not enforced by network transport');
expect(networkSource.includes("url.protocol !== 'https:'"), 'final HTTPS assertion missing');
expect(runtimeSource.includes("env.PROVIDER_RUNTIME_ENABLED !== '1'"), 'provider runtime disable gate missing');
expect(workerIndex.includes('createProviderRuntime'), 'Worker provider runtime wiring missing');
expect(workerApi.includes("providerRuntime.kakao.searchPlaces"), 'Kakao place Worker wiring missing');
expect(workerApi.includes("providerRuntime.kakao.publicTransitRoutes"), 'Kakao route Worker wiring missing');
expect(workerApi.includes('Seoul provider secure transport is unavailable.'), 'Seoul secure-path block missing');
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
  const fakeFetch = async (input, init) => {
    calls.push({ input, init });
    const body = String(input).includes('/v2/routing/publictraffic') ? routeFixture : placeFixture;
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
    DB: {},
  }, fakeFetch);
  expect(enabledRuntime !== null, 'enabled fixture runtime did not construct');

  const places = await enabledRuntime.kakao.searchPlaces('카카오프렌즈', { x: 127.06, y: 37.51 });
  const routes = await enabledRuntime.kakao.publicTransitRoutes(
    { x: 127.11119217, y: 37.39477123 },
    { x: 127.12628814, y: 37.41993056 },
  );
  expect(places[0]?.providerId === '26338954', 'Kakao place network transport mapping mismatch');
  expect(routes[0]?.totalMinutes === 15, 'Kakao route network transport mapping mismatch');
  expect(calls.length === 2, 'Kakao fake fetch call count mismatch');

  const placeCall = calls[0];
  const placeUrl = new URL(placeCall.input);
  expect(placeUrl.protocol === 'https:', 'Kakao materialized URL must stay HTTPS');
  expect(placeUrl.searchParams.get('query') === '카카오프렌즈', 'Kakao materialized query mismatch');
  const authorization = new Headers(placeCall.init?.headers).get('Authorization');
  expect(authorization === 'KakaoAK ' + fakeSecretValue, 'Kakao Authorization materialization mismatch');

  let seoulFetchCount = calls.length;
  let seoulBlocked = '';
  try {
    await enabledRuntime.seoulBus.searchStops('강남역', { x: 127.03, y: 37.49 });
  } catch (error) {
    seoulBlocked = error instanceof Error ? error.message : String(error);
  }
  expect(seoulBlocked === 'Provider activation blocked: INSECURE_ENDPOINT', 'Seoul bus must fail before network');
  expect(calls.length === seoulFetchCount, 'Seoul bus security block must occur before fake fetch');

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
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5M Kakao HTTPS network transport verification passed');

// Phase 5M dependency-backed verification trigger 2.
