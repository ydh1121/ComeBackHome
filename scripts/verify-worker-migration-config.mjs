import { readFile } from 'node:fs/promises';

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const raw = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const config = JSON.parse(raw);
const schedulerConfig = JSON.parse(
  await readFile(new URL('../wrangler.scheduler.jsonc', import.meta.url), 'utf8'),
);
const pagesFunction = await readFile(
  new URL('../functions/api/_middleware.ts', import.meta.url),
  'utf8',
);
const pagesWorkflow = await readFile(
  new URL('../.github/workflows/configure-pages-runtime.yml', import.meta.url),
  'utf8',
);
const schedulerEntry = await readFile(
  new URL('../worker/index.ts', import.meta.url),
  'utf8',
);

expect(config.name === 'come-back-home', 'canonical Pages project name mismatch');
expect(config.pages_build_output_dir === './dist', 'Pages build output mismatch');
expect(config.main == null, 'canonical Pages config must not define a Worker main');
expect(config.workers_dev == null, 'canonical Pages config must not define workers_dev');
expect(config.triggers == null, 'canonical Pages config must not define Worker Cron triggers');
expect(
  Array.isArray(config.compatibility_flags) &&
    config.compatibility_flags.includes('nodejs_compat'),
  'Pages Functions must enable nodejs_compat',
);

expect(
  pagesFunction.includes("handleApiRequest") &&
    pagesFunction.includes("createProviderRuntime") &&
    pagesFunction.includes("context.env"),
  'Pages Function must execute backend directly',
);
expect(!pagesFunction.includes('CBH_RUNTIME'), 'Pages Function must not proxy to a backend Worker');
expect(!pagesWorkflow.includes("service: 'come-back-home-runtime'"), 'Pages must not bind to come-back-home-runtime');
expect(
  pagesWorkflow.includes('d1_databases') &&
    pagesWorkflow.includes("DB: { id: db.database_id }"),
  'Pages runtime must bind D1 directly',
);
for (const name of [
  'KAKAO_REST_API_KEY',
  'VAPID_PRIVATE_KEY',
  'PRESENCE_EVENT_INGEST_TOKEN',
]) {
  expect(pagesWorkflow.includes(name), 'Pages runtime workflow missing binding ' + name);
}
expect(
  pagesWorkflow.includes("preview_deployment_setting: 'none'"),
  'Pages preview deployments must remain disabled',
);
expect(
  pagesWorkflow.includes('https://come-back-home.pages.dev'),
  'canonical Pages origin missing',
);

expect(schedulerConfig.name === 'come-back-home-runtime', 'scheduler must reuse existing Worker identity');
expect(schedulerConfig.main === './worker/index.ts', 'scheduler Worker entry mismatch');
expect(schedulerConfig.workers_dev === false, 'scheduler workers.dev must be disabled');
expect(schedulerConfig.preview_urls === false, 'scheduler preview URLs must be disabled');
expect(schedulerConfig.vars?.PAGES_ORIGIN === 'https://come-back-home.pages.dev', 'scheduler must target canonical Pages');
expect(Array.isArray(schedulerConfig.triggers?.crons) && schedulerConfig.triggers.crons[0] === '* * * * *', 'scheduler Cron mismatch');
expect(schedulerConfig.d1_databases == null, 'scheduler Worker must not bind D1');
expect(!schedulerEntry.includes('handleApiRequest'), 'scheduler Worker must not host application API');
expect(!schedulerEntry.includes('createProviderRuntime'), 'scheduler Worker must not host provider runtime');
expect(!schedulerEntry.includes('ASSETS'), 'scheduler Worker must not serve SPA assets');
expect(schedulerEntry.includes('/api/internal/scheduler-tick'), 'scheduler Worker must invoke canonical Pages tick');

const providerRuntimeEnabled = config.vars?.PROVIDER_RUNTIME_ENABLED;
const pushDeliveryEnabled = config.vars?.PUSH_DELIVERY_ENABLED;
expect(providerRuntimeEnabled === '1', 'canonical Pages provider runtime must be enabled');
expect(pushDeliveryEnabled === '1', 'canonical Pages push delivery must be enabled');
expect(config.vars?.MUTATIONS_ENABLED === '1', 'canonical Pages mutations must be enabled');
expect(
  /^[A-Za-z0-9_-]{80,100}$/.test(config.vars?.VAPID_PUBLIC_KEY ?? ''),
  'canonical Pages public VAPID key missing',
);
expect(
  config.vars?.VAPID_SUBJECT === 'https://come-back-home.pages.dev/',
  'canonical Pages VAPID subject mismatch',
);

expect(
  Array.isArray(config.d1_databases) && config.d1_databases.length === 1,
  'canonical Pages config must contain exactly one D1 binding',
);
const db = config.d1_databases?.[0];
expect(db?.binding === 'DB', 'canonical D1 binding must be DB');
expect(db?.database_name === 'come-back-home-db', 'canonical D1 database mismatch');
expect(
  typeof db?.database_id === 'string' &&
    db.database_id.length > 0 &&
    db.database_id !== '00000000-0000-0000-0000-000000000000',
  'canonical D1 id must be non-placeholder',
);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Pages + minimal private scheduler configuration verification passed');
