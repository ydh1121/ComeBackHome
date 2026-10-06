import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const failures = [];
const contracts = await read('../worker/contracts.ts');
const schema = await read('../db/migrations/0001_initial.sql');
const architecture = await read('../docs/backend-architecture.md');
const pagesFunction = await read('../functions/api/_middleware.ts');
const schedulerEntry = await read('../worker/index.ts');
const schedulerConfig = JSON.parse(await read('../wrangler.scheduler.jsonc'));

for (const text of [
  "deploymentName: 'come-back-home'",
  "runtime: 'cloudflare-pages-functions'",
  "frontend: 'cloudflare-pages'",
  "database: 'cloudflare-d1'",
  "databaseName: 'come-back-home-db'",
  "databaseBinding: 'DB'",
  "scheduler: 'private-worker-cron-to-pages'",
  "schedulerResource: 'come-back-home-runtime'",
  "schedulerEndpoint: '/api/internal/scheduler-tick'",
  "schedulerPublicUrl: false",
  "access: 'canonical-pages-origin'",
]) {
  if (!contracts.includes(text)) failures.push('backend decision missing ' + text);
}

for (const text of [
  'interface SubscriptionStore',
  'interface NotificationJobStore',
  'interface PushDeliveryGateway',
  'dedupeKey: string',
  'claimDue(nowIso: string, limit: number)',
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
  'https://come-back-home.pages.dev/',
  'Pages Functions',
  'PAGES + MINIMAL PRIVATE SCHEDULER',
  'come-back-home-runtime',
  '/api/internal/scheduler-tick',
  'LEFT_WORK',
  'ARRIVED_HOME',
  'DB',
]) {
  if (!architecture.includes(text)) failures.push('Pages architecture rationale missing ' + text);
}

for (const text of [
  'handleApiRequest',
  'createProviderRuntime',
  'context.env',
]) {
  if (!pagesFunction.includes(text)) failures.push('Pages backend entry missing ' + text);
}
if (pagesFunction.includes('CBH_RUNTIME')) failures.push('Pages backend still proxies to CBH_RUNTIME');
if (schedulerEntry.includes('handleApiRequest')) failures.push('scheduler Worker must not host the application API');
if (schedulerEntry.includes('createProviderRuntime')) failures.push('scheduler Worker must not host providers');
if (schedulerEntry.includes('ASSETS')) failures.push('scheduler Worker must not serve the SPA');
if (!schedulerEntry.includes('/api/internal/scheduler-tick')) failures.push('scheduler Worker must target canonical Pages');
if (schedulerConfig.name !== 'come-back-home-runtime') failures.push('scheduler Worker identity mismatch');
if (schedulerConfig.workers_dev !== false) failures.push('scheduler workers.dev must be disabled');
if (schedulerConfig.preview_urls !== false) failures.push('scheduler preview URLs must be disabled');
if (schedulerConfig.d1_databases != null) failures.push('scheduler Worker must not bind D1');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('phase 5D Pages + minimal scheduler architecture verification passed');
