import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const contracts = await read('../worker/providers/contracts.ts');
const plan = await read('../worker/providers/source-plan.ts');
const docs = await read('../docs/provider-feasibility.md');
const workerApi = await read('../worker/api.ts');
const wranglerLocal = JSON.parse(await read('../wrangler.local.jsonc'));

for (const name of [
  'KakaoMapSource',
  'SeoulBusSource',
  'SeoulSubwaySource',
  'ProviderSecretBindings',
  'ProviderFreshnessPolicy',
  'ProviderFallbackPolicy',
]) {
  expect(contracts.includes('interface ' + name), 'provider source contract missing ' + name);
}

for (const secret of [
  'KAKAO_REST_API_KEY',
  'SEOUL_SUBWAY_API_KEY',
  'SEOUL_BUS_SERVICE_KEY',
]) {
  expect(contracts.includes(secret), 'secret binding contract missing ' + secret);
}

for (const source of ["'kakao-map'", "'seoul-bus'", "'seoul-subway'"]) {
  expect(plan.includes(source), 'source plan missing ' + source);
}
expect(plan.includes("externalRequestsAllowedInPhase5I: false"), 'Phase5I external request guard missing');
expect(plan.includes("remoteActivationAllowedInPhase5I: false"), 'Phase5I remote activation guard missing');
expect(plan.includes("fabricatedRealtimeAllowed: false"), 'fabricated realtime guard missing');

for (const forbidden of ['KakaoAK ', 'serviceKey=', 'swopenAPI.seoul.go.kr/api/subway/']) {
  expect(!contracts.includes(forbidden), 'contracts contain live credential/request material ' + forbidden);
  expect(!plan.includes(forbidden), 'source plan contains live credential/request material ' + forbidden);
}

expect(!contracts.includes('fetch('), 'Phase5I contracts must not perform external fetch');
expect(!plan.includes('fetch('), 'Phase5I source plan must not perform external fetch');
expect(!workerApi.includes('dapi.kakao.com'), 'Worker API activated Kakao request too early');
expect(!workerApi.includes('swopenAPI.seoul.go.kr'), 'Worker API activated Seoul subway request too early');
expect(wranglerLocal.vars?.PROVIDER_RUNTIME_ENABLED === '0', 'local provider runtime must remain disabled');

for (const text of [
  'Kakao Map REST API',
  'public-transit route retrieval',
  '100,000 requests/day',
  '1,000 requests/day',
  'recptnDt',
  'FALLBACK or UNKNOWN',
  'Exact LIVE/STALE duration thresholds are intentionally deferred',
]) {
  expect(docs.includes(text), 'feasibility docs missing ' + text);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('phase 5I provider feasibility verification passed');
