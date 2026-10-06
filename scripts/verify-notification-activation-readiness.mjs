import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };
const workerEntry = await readFile(new URL('../worker/index.ts', import.meta.url), 'utf8');
const readinessSource = await readFile(
  new URL('../worker/notification-activation-readiness.ts', import.meta.url),
  'utf8',
);

expect(
  workerEntry.includes('runScheduledNotificationCycle(env, controller.scheduledTime)'),
  'Worker scheduled entry must remain fail-closed without live dependency injection',
);
expect(
  !workerEntry.includes('createNotificationActivationReadiness'),
  'readiness factory must not be wired into Worker entry before activation approval',
);
for (const key of [
  'VAPID_SUBJECT',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'WEB_PUSH_TTL_SECONDS',
  'NOTIFICATION_RETRY_DELAYS_SECONDS',
  'KAKAO_REST_API_KEY',
  'PROVIDER_RUNTIME',
]) {
  expect(readinessSource.includes("'" + key + "'"), 'readiness requirement missing ' + key);
}

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const module = await vite.ssrLoadModule('/worker/notification-activation-readiness.ts');
  const db = {
    prepare() {
      throw new Error('readiness verification must not touch D1 while composing dependencies');
    },
    async batch() { return []; },
  };
  const providers = {
    kakao: {
      async searchPlaces() { return []; },
      async publicTransitRoutes() { return []; },
    },
    seoulBus: {
      async searchStops() { return []; },
      async arrivals() { return []; },
    },
    seoulSubway: {
      async searchStations() { return []; },
      async arrivals() { return []; },
      async trainPositions() { return []; },
    },
  };

  const empty = module.createNotificationActivationReadiness({ DB: db }, null);
  expect(empty.ready === false && empty.dependencies == null, 'empty activation config must fail closed');
  for (const key of [
    'VAPID_SUBJECT',
    'VAPID_PUBLIC_KEY',
    'VAPID_PRIVATE_KEY',
    'WEB_PUSH_TTL_SECONDS',
    'NOTIFICATION_RETRY_DELAYS_SECONDS',
    'KAKAO_REST_API_KEY',
    'PROVIDER_RUNTIME',
  ]) {
    expect(empty.missing.includes(key), 'empty readiness missing list lost ' + key);
  }

  const invalid = module.createNotificationActivationReadiness({
    DB: db,
    VAPID_SUBJECT: 'mailto:owner@example.com',
    VAPID_PUBLIC_KEY: 'public-key',
    VAPID_PRIVATE_KEY: 'private-key',
    WEB_PUSH_TTL_SECONDS: '-1',
    NOTIFICATION_RETRY_DELAYS_SECONDS: '30,invalid',
    KAKAO_REST_API_KEY: 'kakao-key',
  }, providers);
  expect(invalid.ready === false, 'invalid numeric activation config must fail closed');
  expect(invalid.missing.includes('WEB_PUSH_TTL_SECONDS'), 'invalid TTL must remain missing');
  expect(invalid.missing.includes('NOTIFICATION_RETRY_DELAYS_SECONDS'), 'invalid retry schedule must remain missing');

  const ready = module.createNotificationActivationReadiness({
    DB: db,
    VAPID_SUBJECT: 'mailto:owner@example.com',
    VAPID_PUBLIC_KEY: 'public-key',
    VAPID_PRIVATE_KEY: 'private-key',
    WEB_PUSH_TTL_SECONDS: '300',
    NOTIFICATION_RETRY_DELAYS_SECONDS: '30,90,300',
    KAKAO_REST_API_KEY: 'kakao-key',
  }, providers);
  expect(ready.ready === true, 'complete activation config must compose dependencies');
  expect(ready.missing.length === 0, 'ready activation config must have no missing requirements');
  expect(ready.dependencies?.planner?.etaSource != null, 'ready dependencies missing ETA source');
  expect(ready.dependencies?.outbox?.gateway != null, 'ready dependencies missing Web Push gateway');
  expect(ready.dependencies?.outbox?.retryPolicy != null, 'ready dependencies missing retry policy');
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('notification activation readiness verification passed');
