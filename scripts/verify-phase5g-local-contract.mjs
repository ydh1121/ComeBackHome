import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const failures = [];

const configText = await read('../wrangler.local.jsonc');
const config = JSON.parse(configText);
const pkg = JSON.parse(await read('../package.json'));
const integration = await read('./verify-phase5g-local.mjs');
const gitignore = await read('../.gitignore');
const migration = await read('../db/migrations/0001_initial.sql');

const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

expect(config.name === 'come-back-home', 'local Wrangler name must remain come-back-home');
expect(config.main === './worker/index.ts', 'local Wrangler main must target worker/index.ts');
expect(config.assets?.directory === './dist', 'static assets directory must be ./dist');
expect(config.assets?.binding === 'ASSETS', 'static assets binding must be ASSETS');
expect(Array.isArray(config.assets?.run_worker_first), 'run_worker_first must be an explicit route list');
expect(config.assets?.run_worker_first?.includes('/api'), 'Worker-first routes must include /api');
expect(config.assets?.run_worker_first?.includes('/api/*'), 'Worker-first routes must include /api/*');
expect(config.assets?.not_found_handling === 'single-page-application', 'SPA asset fallback must be enabled');

const d1 = config.d1_databases?.[0];
expect(config.d1_databases?.length === 1, 'local config must expose exactly one D1 binding');
expect(d1?.binding === 'DB', 'D1 binding must remain DB');
expect(d1?.database_name === 'come-back-home-db', 'D1 database name must remain come-back-home-db');
expect(d1?.database_id === '00000000-0000-0000-0000-000000000000', 'local config must keep the non-remote placeholder database id');
expect(d1?.preview_database_id === 'comebackhome-local', 'local preview database id is missing');
expect(d1?.migrations_dir === 'db/migrations', 'D1 migrations_dir must be db/migrations');
expect(config.vars?.PUSH_DELIVERY_ENABLED === '0', 'local push delivery must stay disabled');

for (const [name, required] of [
  ['cf:local:migrate', ['wrangler d1 migrations apply come-back-home-db', '--local', '--config wrangler.local.jsonc']],
  ['cf:local:dev', ['wrangler dev', '--local', '--config wrangler.local.jsonc']],
  ['verify:local-contract', ['node scripts/verify-phase5g-local-contract.mjs']],
  ['verify:local-integration', ['node scripts/verify-phase5g-local.mjs']],
]) {
  const value = pkg.scripts?.[name] ?? '';
  expect(Boolean(value), 'package script missing ' + name);
  for (const token of required) expect(value.includes(token), name + ' missing ' + token);
}

expect(pkg.devDependencies?.wrangler === '4.146.0', 'Wrangler must be pinned to 4.146.0 for Phase 5G reproducibility');
expect((pkg.scripts?.check ?? '').includes('npm run verify:local-contract'), 'npm check must include the static Phase 5G contract guard');
expect(gitignore.split(/\r?\n/).includes('.wrangler/'), '.wrangler local state must be ignored');

for (const token of [
  '--local',
  '--persist-to',
  "VITE_CBH_RUNTIME: 'api'",
  "ssrLoadModule('/src/app/composition.ts')",
  'createHybridApiApplicationServices',
  'SAMPLE_IMPORT_WORKBOOK_BASE64',
  'services.actions.importFiles.accept',
  'services.actions.commitImportReview.execute(importBatchId)',
  'real XLSX parser to hybrid D1 schedule commit',
  '/api/health',
  '/api/bootstrap',
]) {
  expect(integration.includes(token), 'local integration harness missing ' + token);
}

for (const forbidden of ['--remote', 'wrangler deploy', 'wrangler d1 create', 'account_id', 'VAPID_PRIVATE_KEY']) {
  expect(!configText.includes(forbidden), 'local config contains forbidden remote/live token ' + forbidden);
  expect(!integration.includes(forbidden), 'local integration harness contains forbidden remote/live token ' + forbidden);
  for (const name of ['cf:local:migrate', 'cf:local:dev', 'verify:local-integration']) {
    expect(!(pkg.scripts?.[name] ?? '').includes(forbidden), name + ' contains forbidden remote/live token ' + forbidden);
  }
}

for (const table of ['people', 'places', 'schedules', 'transit_access_points', 'commute_preferences', 'notification_settings']) {
  expect(migration.includes('CREATE TABLE ' + table), 'local migration source missing table ' + table);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5G local integration contract verification passed');
