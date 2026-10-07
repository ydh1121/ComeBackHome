import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const securitySource = await readFile(new URL('../worker/providers/security.ts', import.meta.url), 'utf8');
const docs = await readFile(new URL('../docs/provider-secure-transport.md', import.meta.url), 'utf8');
const sourceClients = await readFile(new URL('../worker/providers/source-clients.ts', import.meta.url), 'utf8');

expect(!securitySource.includes('fetch('), 'security gate must not implement fetch');
expect(securitySource.includes('ProviderSecretPresenceResolver'), 'secret-presence resolver contract missing');
expect(securitySource.includes("'INSECURE_ENDPOINT'"), 'insecure endpoint reason missing');
expect(securitySource.includes("'UNVERIFIED_TRANSPORT'"), 'unverified transport reason missing');
expect(securitySource.includes("'MISSING_SECRET'"), 'missing secret reason missing');

for (const text of [
  'ws.bus.go.kr',
  'swopenapi.seoul.go.kr',
  'openapi.seoul.go.kr',
  'OFFICIAL SEOUL HTTP ALLOWLIST ACTIVE / SECRET-GATED',
  'never returned to the browser',
]) {
  expect(docs.includes(text), 'secure-transport docs missing ' + text);
}

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const security = await vite.ssrLoadModule('/worker/providers/security.ts');

  const presentSecrets = { has: () => true };
  const missingSecrets = { has: () => false };

  const kakaoRequest = {
    source: 'kakao-map',
    capability: 'public-transit-routing',
    method: 'GET',
    urlTemplate: 'https://dapi.kakao.com/v2/routing/publictraffic',
    auth: {
      secretName: 'KAKAO_REST_API_KEY',
      placement: 'header',
      target: 'Authorization',
      prefix: 'KakaoAK ',
    },
    security: 'TLS_VERIFIED',
  };

  const kakaoReady = security.assessProviderActivation(kakaoRequest, presentSecrets);
  expect(kakaoReady.ready === true, 'Kakao HTTPS request should be security-ready when secret is present');

  const kakaoMissing = security.assessProviderActivation(kakaoRequest, missingSecrets);
  expect(kakaoMissing.ready === false && kakaoMissing.reason === 'MISSING_SECRET', 'Kakao missing-secret gate mismatch');

  for (const urlTemplate of [
    'http://ws.bus.go.kr/api/rest/stationinfo/getStationByName',
    'http://openAPI.seoul.go.kr:8088/{SEOUL_OPENAPI_KEY}/json/SearchInfoBySubwayNameService/1/20/{stationName}/',
    'http://swopenAPI.seoul.go.kr/api/subway/{SEOUL_SUBWAY_API_KEY}/json/realtimeStationArrival/0/20/{stationName}',
  ]) {
    const blocked = security.assessProviderActivation({
      source: urlTemplate.includes('bus.go.kr') ? 'seoul-bus' : 'seoul-subway',
      capability: 'fixture-security-check',
      method: 'GET',
      urlTemplate,
      auth: {
        secretName: urlTemplate.includes('bus.go.kr')
          ? 'SEOUL_BUS_SERVICE_KEY'
          : urlTemplate.includes('openAPI.seoul.go.kr:8088')
            ? 'SEOUL_OPENAPI_KEY'
            : 'SEOUL_SUBWAY_API_KEY',
        placement: urlTemplate.includes('bus.go.kr') ? 'query' : 'path',
        target: 'credential',
      },
      security: 'DOCUMENTED_HTTP_REQUIRES_VALIDATION',
    }, presentSecrets);
    expect(blocked.ready === true, 'Documented Seoul HTTP request must pass the official-host allowlist: ' + urlTemplate);
  }

  const httpsButUnverified = security.assessProviderActivation({
    ...kakaoRequest,
    urlTemplate: 'https://example.invalid/provider',
    security: 'DOCUMENTED_HTTP_REQUIRES_VALIDATION',
  }, presentSecrets);
  expect(
    httpsButUnverified.ready === false && httpsButUnverified.reason === 'UNVERIFIED_TRANSPORT',
    'HTTPS alone must not override an unverified security classification',
  );

  let blockedError = '';
  try {
    security.assertProviderActivationReady({
      ...kakaoRequest,
      urlTemplate: 'http://example.invalid/provider',
      security: 'DOCUMENTED_HTTP_REQUIRES_VALIDATION',
    }, presentSecrets);
  } catch (error) {
    blockedError = error instanceof Error ? error.message : String(error);
  }
  expect(blockedError === 'Provider activation blocked: UNVERIFIED_TRANSPORT', 'fail-closed assertion mismatch');
} finally {
  await vite.close();
}

expect(sourceClients.includes("security: 'TLS_VERIFIED'"), 'Kakao client TLS classification missing');
expect(sourceClients.includes("security: 'DOCUMENTED_HTTP_REQUIRES_VALIDATION'"), 'Seoul unverified classification missing');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5L secure provider transport verification passed');
