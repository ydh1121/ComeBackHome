import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const failures = [];

const runtimeConfig = await read('../src/config/runtime.ts');
const httpClient = await read('../src/providers/http/HttpJsonClient.ts');
const httpRepositories = await read('../src/providers/http/HttpRepositories.ts');
const composition = await read('../src/app/composition.ts');
const runtimeContracts = await read('../src/application/contracts/runtime.ts');
const scheduleService = await read('../src/application/services/ApplicationActions.ts');
const workerApi = await read('../worker/api.ts');
const main = await read('../src/main.tsx');
const today = await read('../src/pages/TodayPage.tsx');
const qa = await read('../src/pages/QaStateMatrixPage.tsx');
const docs = await read('../docs/runtime-modes.md');

for (const text of [
  "export type AppRuntimeMode = 'mock' | 'api'",
  "import.meta.env.DEV ? 'mock' : 'api'",
  "if (value === 'mock') return 'mock'",
  "if (value === 'api') return 'api'",
  'Unsupported VITE_CBH_RUNTIME value',
]) {
  if (!runtimeConfig.includes(text)) failures.push('runtime gate missing ' + text);
}

for (const text of [
  "private readonly basePath = '/api'",
  "credentials: 'same-origin'",
  "if (!path.startsWith('/'))",
  'this.basePath + path',
]) {
  if (!httpClient.includes(text)) failures.push('same-origin HTTP client missing ' + text);
}
for (const forbidden of ['http://', 'https://', 'VITE_API', 'API_BASE_URL']) {
  if (httpClient.includes(forbidden)) failures.push('configurable/external API base leaked: ' + forbidden);
}

for (const name of [
  'HttpPersonRepository',
  'HttpScheduleRepository',
  'HttpPlaceRepository',
  'HttpCommuteRepository',
  'HttpNotificationRepository',
  'HttpPushSubscriptionTransport',
]) {
  if (!httpRepositories.includes('class ' + name)) failures.push('HTTP adapter missing ' + name);
}

for (const text of [
  "await this.client.put(\n      '/people/' + encodeURIComponent(personId) + '/schedules'",
  "await this.client.put('/schedules/import', { schedules: entries })",
  'permission: this.permission',
  'subscription: this.subscription',
  "await this.client.put('/notifications/settings'",
  "await this.client.put('/push/subscription'",
  "await this.client.delete('/push/subscription'",
]) {
  if (!httpRepositories.includes(text)) failures.push('HTTP repository contract missing ' + text);
}

for (const text of [
  'createHybridApiApplicationServices',
  "new HttpJsonClient('/api'",
  'new HttpPersonRepository(client)',
  'new HttpScheduleRepository(client)',
  'new HttpPlaceRepository(client)',
  "const commute = providerMode === 'api' && routeProvider",
  ': persistedCommute',
  "mode: 'hybrid-api'",
  "persistence: 'worker-api'",
  "providerData: providerMode === 'api' ? 'worker-api' : 'disabled'",
  'new WorkbookImportFileSelectionAction',
  'new ReadExcelWorkbookParser',
  'commitImportReview: new CommitImportReview(imports, schedules, new HttpApprovedWorkbookImportGateway(client))',
]) {
  if (!composition.includes(text)) failures.push('hybrid composition missing ' + text);
}
for (const text of [
  "segments[1] === 'schedules'",
  "segments[2] === 'import'",
  "Duplicate person/date in import batch.",
  "Import references unknown person.",
  'await schedules.upsertMany(entries)',
]) {
  if (!workerApi.includes(text)) failures.push('Atomic multi-person import API missing ' + text);
}
if (!workerApi.includes("segments[1] === 'workbooks'") ||
    !workerApi.includes('commitApprovedWorkbookImport(env.DB')) {
  failures.push('approved workbook single-transaction API route missing');
}
if (!composition.includes('new HttpApprovedWorkbookImportGateway(client)')) {
  failures.push('approved workbook HTTP gateway missing');
}
if (httpRepositories.includes('class HybridCommuteRepository')) failures.push('obsolete hybrid commute adapter remains in production source');
if (composition.includes('BrowserPushSubscriptionProvider')) failures.push('browser push adapter activated in hybrid composition');
if (composition.includes('HttpPushSubscriptionTransport')) failures.push('push transport activated in hybrid composition');

for (const text of [
  "mode: 'mock' | 'hybrid-api'",
  "persistence: 'mock' | 'worker-api'",
  "providerData: 'mock' | 'worker-api' | 'disabled'",
]) {
  if (!runtimeContracts.includes(text)) failures.push('runtime metadata contract missing ' + text);
}

if (!scheduleService.includes('await this.schedules.upsertMany(updated)')) failures.push('bulk schedule is not batch-backed');

for (const text of [
  "segments.length === 4 && request.method === 'PUT'",
  'await schedules.upsertMany(entries)',
  "segments[4] === 'preferred-route'",
  "segments[1] === 'commute' && segments[2] === 'access'",
]) {
  if (!workerApi.includes(text)) failures.push('Worker API missing hybrid adapter route ' + text);
}

for (const text of [
  'const runtimeMode = resolveRuntimeMode()',
  'const providerMode = resolveProviderRuntimeMode()',
  "import.meta.env.DEV && runtimeMode === 'mock'",
  "root.textContent = 'ComeBackHome 시작 실패: '",
]) {
  if (!main.includes(text)) failures.push('main runtime bootstrap missing ' + text);
}

if (today.includes('services.runtime.persistence') || today.includes('services.runtime.providerData')) failures.push('developer runtime source label leaked into Today');
if (!qa.includes('services.runtime.persistence') || !qa.includes('services.runtime.providerData')) failures.push('QA runtime source label missing');

for (const text of [
  'VITE_CBH_RUNTIME=api',
  'same-origin /api/*',
  'Excel and image/OCR imports run through production parsers',
  'Web Push subscription transport and notification delivery use the production software path',
]) {
  const normalizedDocs = docs.replaceAll('`', '');
  if (!normalizedDocs.includes(text)) failures.push('runtime mode documentation missing ' + text);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5F HTTP adapter and composition verification passed');
