import { readFile } from 'node:fs/promises';

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const raw = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const config = JSON.parse(raw);

expect(config.name === 'come-back-home-runtime', 'production Worker staging name mismatch');
expect(config.main === './worker/index.ts', 'Worker entry mismatch');
expect(config.preview_urls === true, 'Worker preview URLs must be enabled');
expect(config.assets?.directory === './dist', 'Worker static asset directory mismatch');
expect(config.assets?.binding === 'ASSETS', 'Worker asset binding mismatch');
expect(
  Array.isArray(config.assets?.run_worker_first) &&
  config.assets.run_worker_first.includes('/api') &&
  config.assets.run_worker_first.includes('/api/*'),
  'Worker must run first for /api routes',
);
expect(
  config.assets?.not_found_handling === 'single-page-application',
  'Worker SPA fallback mismatch',
);
expect(
  config.vars?.MUTATIONS_ENABLED === '0',
  'Worker staging config must keep public API mutations disabled',
);
expect(
  config.vars?.PUSH_DELIVERY_ENABLED === '0',
  'Worker staging config must keep push delivery disabled',
);
expect(
  config.vars?.PROVIDER_RUNTIME_ENABLED === '0',
  'Worker staging config must keep provider runtime disabled',
);

if (config.d1_databases != null) {
  expect(
    Array.isArray(config.d1_databases) && config.d1_databases.length === 1,
    'Worker staging config may have at most one verified D1 binding',
  );
  const db = config.d1_databases?.[0];
  expect(db?.binding === 'DB', 'verified D1 binding must be named DB');
  expect(db?.database_name === 'come-back-home-db', 'verified D1 database name mismatch');
  expect(
    typeof db?.database_id === 'string' &&
    db.database_id.length > 0 &&
    db.database_id !== '00000000-0000-0000-0000-000000000000',
    'verified D1 database id must be a real non-placeholder id',
  );
}

expect(
  !Array.isArray(config.triggers?.crons),
  'Cron must not be activated in staging config before remote readiness',
);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Worker migration staging config verification passed');
