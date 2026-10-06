import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const retry = await vite.ssrLoadModule('/worker/notification-retry-policy.ts');
  const policy = new retry.FixedDelayNotificationRetryPolicy([30, 90, 300]);
  const base = {
    id: 'job-1',
    dedupeKey: 'job-1',
    personId: 'person-1',
    type: 'fixture',
    scheduledFor: '2026-10-06T12:00:00.000Z',
    nextAttemptAt: '2026-10-06T12:00:00.000Z',
    status: 'processing',
    payload: { title: 'ComeBackHome', body: 'fixture', tag: 'fixture', path: '/' },
    sentAt: null,
    lastError: null,
  };
  const now = new Date('2026-10-06T12:00:00.000Z');

  expect(
    policy.nextAttempt({ ...base, attempts: 1 }, new Error('first'), now) === '2026-10-06T12:00:30.000Z',
    'first failed attempt must use first configured delay',
  );
  expect(
    policy.nextAttempt({ ...base, attempts: 2 }, new Error('second'), now) === '2026-10-06T12:01:30.000Z',
    'second failed attempt must use second configured delay',
  );
  expect(
    policy.nextAttempt({ ...base, attempts: 3 }, new Error('third'), now) === '2026-10-06T12:05:00.000Z',
    'third failed attempt must use third configured delay',
  );
  expect(
    policy.nextAttempt({ ...base, attempts: 4 }, new Error('done'), now) == null,
    'attempt beyond configured delays must stop retrying',
  );

  let emptyRejected = false;
  try {
    new retry.FixedDelayNotificationRetryPolicy([]);
  } catch {
    emptyRejected = true;
  }
  expect(emptyRejected, 'empty retry schedule must fail closed');

  let negativeRejected = false;
  try {
    new retry.FixedDelayNotificationRetryPolicy([30, -1]);
  } catch {
    negativeRejected = true;
  }
  expect(negativeRejected, 'negative retry delay must fail closed');
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('notification retry policy verification passed');
