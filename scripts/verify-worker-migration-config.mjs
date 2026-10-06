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

const providerRuntimeEnabled = config.vars?.PROVIDER_RUNTIME_ENABLED;
const pushDeliveryEnabled = config.vars?.PUSH_DELIVERY_ENABLED;

expect(
  providerRuntimeEnabled === '0' || providerRuntimeEnabled === '1',
  'PROVIDER_RUNTIME_ENABLED must be 0 or 1',
);
expect(
  pushDeliveryEnabled === '0' || pushDeliveryEnabled === '1',
  'PUSH_DELIVERY_ENABLED must be 0 or 1',
);

let secretInventory = null;
if (providerRuntimeEnabled === '1' || pushDeliveryEnabled === '1') {
  secretInventory = JSON.parse(
    await readFile(new URL('../runtime-evidence/cloudflare-worker-secret-inventory.json', import.meta.url), 'utf8'),
  );
  expect(secretInventory.valuesExposed === false, 'Worker secret evidence must never expose values');
  expect(Array.isArray(secretInventory.secretNames), 'Worker secret inventory must contain secret names');
}

if (providerRuntimeEnabled === '1') {
  expect(
    secretInventory?.secretNames?.includes('KAKAO_REST_API_KEY'),
    'provider activation requires verified KAKAO_REST_API_KEY Worker secret',
  );
}

if (pushDeliveryEnabled === '1') {
  expect(providerRuntimeEnabled === '1', 'push activation requires provider runtime enabled first');
  expect(
    secretInventory?.secretNames?.includes('VAPID_PRIVATE_KEY'),
    'push activation requires verified VAPID_PRIVATE_KEY Worker secret',
  );
  expect(
    /^[A-Za-z0-9_-]{80,100}$/.test(config.vars?.VAPID_PUBLIC_KEY ?? ''),
    'push activation requires a valid public VAPID key',
  );
  expect(
    typeof config.vars?.VAPID_SUBJECT === 'string' && config.vars.VAPID_SUBJECT.length > 0,
    'push activation requires VAPID_SUBJECT',
  );
  expect(
    /^\d+$/.test(config.vars?.WEB_PUSH_TTL_SECONDS ?? '') &&
      Number(config.vars.WEB_PUSH_TTL_SECONDS) > 0,
    'push activation requires positive WEB_PUSH_TTL_SECONDS',
  );
  expect(
    /^\d+(,\d+)*$/.test(config.vars?.NOTIFICATION_RETRY_DELAYS_SECONDS ?? ''),
    'push activation requires retry delays',
  );
}

if (config.vars?.MUTATIONS_ENABLED === '1') {
  const access = JSON.parse(
    await readFile(new URL('../runtime-evidence/cloudflare-access-comebackhome.json', import.meta.url), 'utf8'),
  );
  expect(access.name === 'ComeBackHome Runtime', 'protected mutation mode requires ComeBackHome Access app');
  expect(
    access.domain === 'come-back-home-runtime.ydh1121.workers.dev',
    'protected mutation mode Access domain mismatch',
  );
  expect(access.type === 'self_hosted', 'protected mutation mode Access type mismatch');
  expect(access.policyCount === 1, 'protected mutation mode requires exactly one owner policy');
  expect(access.decision === 'allow', 'protected mutation mode requires allow policy');
  expect(
    Array.isArray(access.includeSelectorTypes) &&
    access.includeSelectorTypes.length === 1 &&
    access.includeSelectorTypes[0] === 'email',
    'protected mutation mode requires one email selector',
  );
  expect(access.identityValuesExposed === false, 'Access evidence must not expose identity values');
} else {
  expect(
    config.vars?.MUTATIONS_ENABLED === '0',
    'MUTATIONS_ENABLED must be 0 or 1',
  );
}

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
