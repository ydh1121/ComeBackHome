import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };
const source = await readFile(
  new URL('../worker/push/WebPushDeliveryGateway.ts', import.meta.url),
  'utf8',
);

for (const text of [
  "import webPush from 'web-push'",
  'class WebPushDeliveryGateway',
  'vapidDetails:',
  'TTL: this.config.ttlSeconds',
  "statusCode === 404 || statusCode === 410",
  "statusCode === 429",
  "new PushDeliveryError(message, 'terminal-subscription')",
  "new PushDeliveryError(message, 'transient')",
  "new PushDeliveryError(message, 'permanent')",
]) {
  expect(source.includes(text), 'web push gateway missing ' + text);
}
expect(!source.includes('setVapidDetails'), 'gateway must not mutate global web-push VAPID state');
expect(!source.includes('VAPID_PRIVATE_KEY='), 'gateway must not contain a VAPID private value');

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const module = await vite.ssrLoadModule('/worker/push/WebPushDeliveryGateway.ts');

  const subscription = {
    id: 'sub-1',
    endpoint: 'https://push.example.invalid/sub-1',
    expirationTime: null,
    keys: { p256dh: 'receiver-key', auth: 'receiver-auth' },
    active: true,
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
  };
  const payload = {
    title: 'ComeBackHome',
    body: '퇴근 예정 22:00',
    tag: 'cbh:test',
    path: '/',
  };
  const calls = [];
  const sender = {
    async sendNotification(sub, body, options) {
      calls.push({ sub, body, options });
    },
  };
  const gateway = new module.WebPushDeliveryGateway({
    subject: 'mailto:owner@example.com',
    publicKey: 'public-key',
    privateKey: 'private-key',
    ttlSeconds: 300,
    urgency: 'high',
  }, sender);

  await gateway.send(subscription, payload);
  expect(calls.length === 1, 'successful push must invoke sender once');
  expect(calls[0]?.sub.endpoint === subscription.endpoint, 'push endpoint mismatch');
  expect(calls[0]?.sub.keys.p256dh === 'receiver-key', 'push p256dh mismatch');
  expect(JSON.parse(calls[0]?.body ?? '{}').tag === 'cbh:test', 'push payload mismatch');
  expect(calls[0]?.options.vapidDetails.privateKey === 'private-key', 'per-send VAPID details missing');
  expect(calls[0]?.options.TTL === 300 && calls[0]?.options.urgency === 'high', 'delivery options mismatch');

  const expectKind = async (statusCode, expectedKind) => {
    const failing = new module.WebPushDeliveryGateway({
      subject: 'https://example.com/contact',
      publicKey: 'public-key',
      privateKey: 'private-key',
      ttlSeconds: 60,
    }, {
      async sendNotification() {
        const error = new Error('push failed');
        if (statusCode != null) error.statusCode = statusCode;
        throw error;
      },
    });
    try {
      await failing.send(subscription, payload);
      failures.push('expected push failure for ' + String(statusCode));
    } catch (error) {
      expect(error?.kind === expectedKind, 'status ' + String(statusCode) + ' classified as ' + String(error?.kind));
    }
  };

  await expectKind(410, 'terminal-subscription');
  await expectKind(404, 'terminal-subscription');
  await expectKind(429, 'transient');
  await expectKind(503, 'transient');
  await expectKind(null, 'transient');
  await expectKind(400, 'permanent');

  let invalidSubjectBlocked = false;
  try {
    new module.WebPushDeliveryGateway({
      subject: 'not-a-contact-uri',
      publicKey: 'public-key',
      privateKey: 'private-key',
      ttlSeconds: 60,
    }, sender);
  } catch {
    invalidSubjectBlocked = true;
  }
  expect(invalidSubjectBlocked, 'invalid VAPID subject must fail closed');
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Worker web-push delivery gateway verification passed');
