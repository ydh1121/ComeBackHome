import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const failures = [];
const contracts = await read('../worker/contracts.ts');
const schema = await read('../db/migrations/0001_initial.sql');
const architecture = await read('../docs/backend-architecture.md');
const pagesFunction = await read('../functions/api/_middleware.ts');

for (const text of [
  "deploymentName: 'come-back-home'",
  "runtime: 'cloudflare-pages-functions'",
  "frontend: 'cloudflare-pages'",
  "database: 'cloudflare-d1'",
  "databaseName: 'come-back-home-db'",
  "databaseBinding: 'DB'",
  "scheduler: 'event-driven'",
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
  'Separate application Worker: none',
  'Service Binding to a backend Worker: none',
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

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('phase 5D Pages backend architecture verification passed');
