import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const failures = [];

const repositories = await read('../src/application/contracts/repositories.ts');
const importCommit = await read('../src/application/use-cases/commitImportReview.ts');
const mocks = await read('../src/mocks/repositories.ts');
const runtimeTypes = await read('../worker/runtime-types.ts');
const workerEntry = await read('../worker/index.ts');
const api = await read('../worker/api.ts');
const scheduler = await read('../worker/scheduler.ts');
const person = await read('../worker/repositories/D1PersonRepository.ts');
const schedule = await read('../worker/repositories/D1ScheduleRepository.ts');
const place = await read('../worker/repositories/D1PlaceRepository.ts');
const commute = await read('../worker/repositories/D1CommuteRepository.ts');
const notifications = await read('../worker/repositories/D1NotificationSettingsStore.ts');
const subscriptions = await read('../worker/repositories/D1SubscriptionStore.ts');
const jobs = await read('../worker/repositories/D1NotificationJobStore.ts');
const workerTsconfig = await read('../tsconfig.worker.json');

if (!repositories.includes('upsertMany(entries: ScheduleEntry[]): Promise<void>')) failures.push('ScheduleRepository upsertMany contract missing');
if (repositories.includes('transaction<T>(work:')) failures.push('interactive schedule transaction contract remains');
if (!importCommit.includes('await this.schedules.upsertMany(entries)')) failures.push('import commit does not batch schedule writes');
if (importCommit.includes('.transaction(')) failures.push('import commit still uses interactive transaction');
if (!mocks.includes('async upsertMany(entries: ScheduleEntry[])')) failures.push('mock schedule repository missing upsertMany');

for (const text of [
  'interface D1DatabaseLike',
  'prepare(query: string)',
  'batch<T = Record<string, unknown>>',
  'interface WorkerEnv',
  'ASSETS?: StaticAssetFetcher',
]) {
  if (!runtimeTypes.includes(text)) failures.push('worker structural type missing ' + text);
}

for (const text of [
  "url.pathname === '/api'",
  "url.pathname.startsWith('/api/')",
  'handleApiRequest(request, env, providerRuntime)',
  'env.ASSETS.fetch(request)',
  'async scheduled(',
  'ctx.waitUntil(runScheduledTick',
]) {
  if (!workerEntry.includes(text)) failures.push('Worker entrypoint missing ' + text);
}

for (const text of [
  "env.PUSH_DELIVERY_ENABLED !== '1'",
  "status: 'disabled'",
  "emptyResult('not-configured', scheduledAt)",
  'processNotificationOutbox',
  'dependencies.jobs.claimDue(',
  'dependencies.jobs.markSent(',
  'dependencies.jobs.markRetry(',
  'dependencies.jobs.markFailed(',
  'dependencies.subscriptions.deactivateByEndpoint(',
  'if (!dependencies)',
]) {
  if (!scheduler.includes(text)) failures.push('safe scheduler/outbox contract missing ' + text);
}
if (!workerEntry.includes('runScheduledTick(env, controller.scheduledTime)')) failures.push('production scheduled entry must not inject a live gateway yet');

for (const [name, source, required] of [
  ['person', person, ['class D1PersonRepository', 'INSERT INTO people', 'UPDATE people SET']],
  ['schedule', schedule, ['class D1ScheduleRepository', 'batchOrThrow(this.db, statements)', 'ON CONFLICT(person_id, schedule_date)']],
  ['place', place, ['class D1PlaceRepository', 'ON CONFLICT(person_id, kind)']],
  ['commute', commute, ['class D1CommuteRepository', 'transit_access_points', 'commute_preference_steps', 'return [];']],
  ['notification settings', notifications, ['class D1NotificationSettingsStore', 'notification_settings']],
  ['subscription', subscriptions, ['class D1SubscriptionStore', 'push_subscriptions', 'ON CONFLICT(endpoint)']],
  ['jobs', jobs, ['class D1NotificationJobStore', 'ON CONFLICT(dedupe_key) DO NOTHING', "status = 'processing'", 'RETURNING']],
]) {
  for (const text of required) if (!source.includes(text)) failures.push(name + ' adapter missing ' + text);
}

for (const text of [
  "'SELECT 1 AS ok'",
  "segments[1] === 'bootstrap'",
  "segments[1] === 'people'",
  "segments[3] === 'schedules'",
  "segments[3] === 'places'",
  "segments[3] === 'commute'",
  "segments[1] === 'notifications'",
  "segments[1] === 'push'",
  'new D1SubscriptionStore(env.DB)',
]) {
  if (!api.includes(text)) failures.push('API skeleton missing ' + text);
}
if (api.includes('fetch(')) failures.push('API skeleton performs external network fetch');

const workerConfig = JSON.parse(workerTsconfig);
if (!workerConfig.include?.includes('worker/**/*.ts')) failures.push('worker tsconfig does not include worker sources');
if (!workerConfig.compilerOptions?.lib?.includes('WebWorker')) failures.push('worker tsconfig missing WebWorker lib');

for (const source of [workerEntry, api, scheduler, person, schedule, place, commute, notifications, subscriptions, jobs]) {
  for (const forbidden of ['wrangler deploy', '--remote', 'database_id', 'account_id', 'VAPID_PRIVATE_KEY =']) {
    if (source.includes(forbidden)) failures.push('remote/live configuration leaked: ' + forbidden);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5E local Worker and D1 adapter verification passed');
