import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const workerEntry = await readFile(new URL('../worker/index.ts', import.meta.url), 'utf8');
const source = await readFile(new URL('../worker/notification-activation-preflight.ts', import.meta.url), 'utf8');

expect(
  !workerEntry.includes('evaluateNotificationActivationPreflight'),
  'preflight must not activate or wire the scheduled Worker entry',
);
for (const token of [
  'PRESENCE_EVENT_INGEST_TOKEN',
  'PUSH_DELIVERY_ENABLED',
  'PROVIDER_RUNTIME_ENABLED',
  'LIVE_SCHEDULER_WIRING',
  'REMOTE_D1_MIGRATIONS',
  'CLOUDFLARE_CRON',
  'SAME_ORIGIN_DEPLOYMENT',
  'valuesExposed: false',
]) {
  expect(source.includes(token), 'preflight source missing ' + token);
}

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const module = await vite.ssrLoadModule('/worker/notification-activation-preflight.ts');

  const DB = {
    prepare() {
      throw new Error('preflight must not touch D1');
    },
    async batch() {
      throw new Error('preflight must not touch D1');
    },
  };

  const empty = module.evaluateNotificationActivationPreflight({ DB });
  expect(empty.status === 'BLOCKED', 'empty config must be blocked');
  expect(empty.valuesExposed === false, 'preflight must explicitly guarantee no secret values');
  expect(empty.configMissing.includes('VAPID_PRIVATE_KEY'), 'empty config missing VAPID private key');
  expect(empty.configMissing.includes('KAKAO_REST_API_KEY'), 'empty config missing Kakao key');
  expect(empty.operationsPending.includes('PRESENCE_EVENT_INGEST_TOKEN'), 'empty config missing presence ingest token');
  expect(empty.operationsPending.includes('LIVE_SCHEDULER_WIRING'), 'empty config must preserve scheduler wiring gate');

  const secretValues = {
    subject: 'mailto:owner@example.com',
    publicKey: 'public-secret-fixture',
    privateKey: 'private-secret-fixture',
    kakao: 'kakao-secret-fixture',
    presence: 'presence-secret-fixture',
  };
  const env = {
    DB,
    PUSH_DELIVERY_ENABLED: '1',
    PROVIDER_RUNTIME_ENABLED: '1',
    VAPID_SUBJECT: secretValues.subject,
    VAPID_PUBLIC_KEY: secretValues.publicKey,
    VAPID_PRIVATE_KEY: secretValues.privateKey,
    WEB_PUSH_TTL_SECONDS: '300',
    NOTIFICATION_RETRY_DELAYS_SECONDS: '30,90,300',
    KAKAO_REST_API_KEY: secretValues.kakao,
    PRESENCE_EVENT_INGEST_TOKEN: secretValues.presence,
  };

  const blockedByOperations = module.evaluateNotificationActivationPreflight(env);
  expect(blockedByOperations.status === 'BLOCKED', 'complete values alone must not bypass operational gates');
  expect(blockedByOperations.configMissing.length === 0, 'complete values should clear config requirements');
  expect(blockedByOperations.operationsPending.includes('LIVE_SCHEDULER_WIRING'), 'scheduler wiring must remain pending');
  expect(blockedByOperations.operationsPending.includes('REMOTE_D1_MIGRATIONS'), 'remote migration gate must remain pending');

  const ready = module.evaluateNotificationActivationPreflight(env, {
    schedulerWired: true,
    remoteD1MigrationsApplied: true,
    cronConfigured: true,
    sameOriginDeploymentConfigured: true,
  });
  expect(ready.status === 'READY', 'all explicit config and operational gates should produce READY');
  expect(ready.configMissing.length === 0, 'ready preflight cannot have config gaps');
  expect(ready.operationsPending.length === 0, 'ready preflight cannot have pending operations');

  const serialized = JSON.stringify([empty, blockedByOperations, ready]);
  for (const value of Object.values(secretValues)) {
    expect(!serialized.includes(value), 'preflight leaked secret value ' + value);
  }
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('notification activation preflight verification passed');
