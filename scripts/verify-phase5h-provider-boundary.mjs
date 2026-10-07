import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const runtimeConfig = await read('../src/config/runtime.ts');
const runtimeContracts = await read('../src/application/contracts/runtime.ts');
const httpProviders = await read('../src/providers/http/HttpDataProviders.ts');
const composition = await read('../src/app/composition.ts');
const main = await read('../src/main.tsx');
const workerTypes = await read('../worker/runtime-types.ts');
const workerApi = await read('../worker/api.ts');
const wranglerLocal = JSON.parse(await read('../wrangler.local.jsonc'));
const docs = await read('../docs/provider-runtime.md');
const normalizedDocs = docs.replaceAll('`', '');

for (const text of [
  "export type ProviderRuntimeMode = 'mock' | 'api'",
  "import.meta.env.DEV ? 'mock' : 'api'",
  "if (value === 'mock') return 'mock'",
  "if (value === 'api') return 'api'",
  'Unsupported VITE_CBH_PROVIDER_RUNTIME value',
]) {
  expect(runtimeConfig.includes(text), 'provider runtime gate missing ' + text);
}

for (const name of [
  'HttpPlaceSearchProvider',
  'HttpTransitAccessSearchProvider',
  'HttpTransitRouteProvider',
  'HttpRealtimeBusProvider',
  'HttpRealtimeSubwayProvider',
]) {
  expect(httpProviders.includes('class ' + name), 'HTTP provider adapter missing ' + name);
}
for (const text of [
  "'/providers/place-search?'",
  "'/providers/transit-search?'",
  "'/providers/routes?'",
  "'/providers/bus-arrivals?'",
  "'/providers/subway-arrivals?'",
  'new URLSearchParams',
]) {
  expect(httpProviders.includes(text), 'HTTP provider contract missing ' + text);
}
for (const forbidden of ['http://', 'https://', 'VITE_', 'API_BASE_URL']) {
  expect(!httpProviders.includes(forbidden), 'client provider leaked external/configurable endpoint token ' + forbidden);
}

for (const text of [
  "providerData: 'mock' | 'worker-api' | 'disabled'",
]) {
  expect(runtimeContracts.includes(text), 'runtime provider metadata missing ' + text);
}

for (const text of [
  'ProviderRuntimeMode',
  'new HttpPlaceSearchProvider(client)',
  'new HttpTransitAccessSearchProvider(client)',
  "providerData: providerMode === 'api' ? 'worker-api' : 'disabled'",
  "Mock runtime is development-only.",
  "Provider API runtime requires VITE_CBH_RUNTIME=api.",
]) {
  expect(composition.includes(text), 'provider composition missing ' + text);
}

for (const text of [
  'resolveProviderRuntimeMode',
  'const runtimeMode = resolveRuntimeMode()',
  'const providerMode = resolveProviderRuntimeMode()',
  "import.meta.env.DEV && runtimeMode === 'mock'",
  "import('./app/mockComposition')",
]) {
  expect(main.includes(text), 'main provider bootstrap missing ' + text);
}

expect(workerTypes.includes('PROVIDER_RUNTIME_ENABLED?: string;'), 'Worker provider activation env contract missing');
for (const text of [
  "segments[1] === 'providers'",
  "segments[2] === 'status'",
  "segments[2] === 'place-search'",
  "segments[2] === 'transit-search'",
  "segments[2] === 'routes'",
  "segments[2] === 'bus-arrivals'",
  "segments[2] === 'subway-arrivals'",
  "env.PROVIDER_RUNTIME_ENABLED === '1'",
  "Provider runtime is disabled.",
  "Provider adapter is not configured yet.",
]) {
  expect(workerApi.includes(text), 'Worker provider boundary missing ' + text);
}
expect(!workerApi.includes('fetch('), 'Worker API must not perform external provider fetch in Phase 5H');

expect(wranglerLocal.vars?.PROVIDER_RUNTIME_ENABLED === '0', 'local provider runtime must remain disabled');

for (const text of [
  'production default provider mode = api',
  'mock runtime is development-only',
  'same-origin /api/providers/*',
  'PROVIDER_RUNTIME_ENABLED=0',
  'never fixture data',
]) {
  expect(normalizedDocs.includes(text), 'provider runtime docs missing ' + text);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5H provider boundary verification passed');
