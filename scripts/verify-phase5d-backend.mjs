import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const failures = [];

const contracts = await read('../worker/contracts.ts');
const schema = await read('../db/migrations/0001_initial.sql');
const architecture = await read('../docs/backend-architecture.md');

for (const text of [
  "deploymentName: 'come-back-home'",
  "runtime: 'cloudflare-workers'",
  "frontend: 'workers-static-assets'",
  "database: 'cloudflare-d1'",
  "databaseName: 'come-back-home-db'",
  "databaseBinding: 'DB'",
  "databaseLocationHint: 'apac'",
  "schedulerExpression: '* * * * *'",
  "persistedTimestampZone: 'UTC'",
  "productTimezone: 'Asia/Seoul'",
  "queue: 'deferred'",
  "durableObjects: 'not-used'",
  "access: 'cloudflare-access-private-app'",
]) {
  if (!contracts.includes(text)) failures.push('backend decision missing ' + text);
}

for (const text of [
  'interface SubscriptionStore',
  'interface NotificationJobStore',
  'interface PushDeliveryGateway',
  'dedupeKey: string',
  'claimDue(nowIso: string, limit: number)',
  'markRetry(jobId: string',
]) {
  if (!contracts.includes(text)) failures.push('server contract missing ' + text);
}

for (const table of [
  'people',
  'places',
  'schedules',
  'transit_access_points',
  'commute_preferences',
  'commute_preference_steps',
  'notification_settings',
  'push_subscriptions',
  'notification_jobs',
]) {
  if (!schema.includes('CREATE TABLE ' + table)) failures.push('D1 schema missing table ' + table);
}

for (const text of [
  'UNIQUE(person_id, schedule_date)',
  'UNIQUE(person_id, kind)',
  'dedupe_key TEXT NOT NULL UNIQUE',
  'idx_notification_jobs_due',
  'idx_schedules_person_date',
  "timezone TEXT NOT NULL DEFAULT 'Asia/Seoul'",
]) {
  if (!schema.includes(text)) failures.push('D1 schema invariant missing ' + text);
}

for (const forbidden of [
  'CREATE TABLE route_candidates',
  'CREATE TABLE today_snapshots',
  'CREATE TABLE realtime_arrivals',
]) {
  if (schema.includes(forbidden)) failures.push('runtime-only data leaked into persistence: ' + forbidden);
}

for (const text of [
  'single Worker',
  'D1 outbox',
  'Why no Queue yet',
  'Why no Durable Objects',
  'Cloudflare Access',
  'Workers Builds',
  'does not:',
]) {
  if (!architecture.includes(text)) failures.push('architecture rationale missing ' + text);
}

for (const forbidden of [
  'database_id =',
  'account_id =',
  'VAPID_PRIVATE_KEY =',
  'wrangler deploy',
]) {
  if (contracts.includes(forbidden) || architecture.includes(forbidden)) failures.push('live deployment/config leaked: ' + forbidden);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5D backend architecture verification passed');
