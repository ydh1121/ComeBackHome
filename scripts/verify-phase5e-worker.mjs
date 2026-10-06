import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const failures = [];

const repositories = await read('../src/application/contracts/repositories.ts');
const importCommit = await read('../src/application/use-cases/commitImportReview.ts');
const mocks = await read('../src/mocks/repositories.ts');
const runtimeTypes = await read('../worker/runtime-types.ts');
const pagesEntry = await read('../functions/api/_middleware.ts');
const api = await read('../worker/api.ts');
const person = await read('../worker/repositories/D1PersonRepository.ts');
const schedule = await read('../worker/repositories/D1ScheduleRepository.ts');
const place = await read('../worker/repositories/D1PlaceRepository.ts');
const commute = await read('../worker/repositories/D1CommuteRepository.ts');
const notifications = await read('../worker/repositories/D1NotificationSettingsStore.ts');
const subscriptions = await read('../worker/repositories/D1SubscriptionStore.ts');
const jobs = await read('../worker/repositories/D1NotificationJobStore.ts');

if (!repositories.includes('upsertMany(entries: ScheduleEntry[]): Promise<void>')) failures.push('ScheduleRepository upsertMany contract missing');
if (!importCommit.includes('await this.schedules.upsertMany(entries)')) failures.push('import commit does not batch schedule writes');
if (!mocks.includes('async upsertMany(entries: ScheduleEntry[])')) failures.push('mock schedule repository missing upsertMany');

for (const text of [
  'interface D1DatabaseLike',
  'prepare(query: string)',
  'batch<T = Record<string, unknown>>',
  'interface WorkerEnv',
]) {
  if (!runtimeTypes.includes(text)) failures.push('server structural type missing ' + text);
}

for (const text of [
  'handleApiRequest',
  'createProviderRuntime',
  'context.env',
]) {
  if (!pagesEntry.includes(text)) failures.push('Pages API entry missing ' + text);
}
if (pagesEntry.includes('CBH_RUNTIME')) failures.push('Pages API entry still uses a service binding');

for (const [name, source, required] of [
  ['person', person, ['class D1PersonRepository', 'INSERT INTO people', 'UPDATE people SET']],
  ['schedule', schedule, ['class D1ScheduleRepository', 'batchOrThrow(this.db, statements)', 'ON CONFLICT(person_id, schedule_date)']],
  ['place', place, ['class D1PlaceRepository', 'ON CONFLICT(person_id, kind)']],
  ['commute', commute, ['class D1CommuteRepository', 'transit_access_points', 'saved_commute_routes']],
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
  'createNotificationActivationReadiness',
  'processNotificationOutbox',
]) {
  if (!api.includes(text)) failures.push('Pages API implementation missing ' + text);
}
if (api.includes('CBH_RUNTIME')) failures.push('API implementation references obsolete backend service');

for (const source of [pagesEntry, api, person, schedule, place, commute, notifications, subscriptions, jobs]) {
  for (const forbidden of ['wrangler deploy', '--remote', 'account_id', 'VAPID_PRIVATE_KEY =']) {
    if (source.includes(forbidden)) failures.push('remote/live configuration leaked: ' + forbidden);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('phase 5E Pages Functions and D1 adapter verification passed');
