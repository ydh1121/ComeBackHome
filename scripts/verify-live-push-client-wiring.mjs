import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const permissionSource = await read('../src/providers/browser/BrowserNotificationPermissionProvider.ts');
const runtimeSource = await read('../src/app/browserNotificationRuntime.ts');
const compositionSource = await read('../src/app/composition.ts');
const serviceSource = await read('../src/application/services/ApplicationActions.ts');
const testGatewaySource = await read('../src/providers/http/HttpNotificationTestGateway.ts');
const hookSource = await read('../src/features/notifications/useNotificationSettings.ts');
const pwaSource = await read('../src/pwa/registerServiceWorker.ts');
const apiSource = await read('../worker/api.ts');

for (const text of [
  'class BrowserNotificationPermissionProvider',
  'globalThis.isSecureContext',
  'Notification.permission',
  'Notification.requestPermission()',
]) {
  expect(permissionSource.includes(text), 'browser notification permission adapter missing ' + text);
}

for (const text of [
  'createWebPushClientConfig',
  'VITE_CBH_VAPID_PUBLIC_KEY',
  'new BrowserNotificationPermissionProvider()',
  'new BrowserPushSubscriptionProvider(config, async () =>',
  'new HttpPushSubscriptionTransport(client)',
]) {
  expect(runtimeSource.includes(text), 'browser notification runtime missing ' + text);
}
expect(!runtimeSource.includes('VAPID_PRIVATE_KEY'), 'browser runtime must not contain VAPID private key');
expect(!runtimeSource.includes('mailto:'), 'browser runtime must not hard-code VAPID subject');

for (const text of [
  'createBrowserNotificationRuntime(client)',
  'browserNotifications.permissionProvider',
  'browserNotifications.subscriptionProvider',
  'browserNotifications.subscriptionTransport',
]) {
  expect(compositionSource.includes(text), 'hybrid composition missing browser push wiring ' + text);
}

for (const text of [
  'private readonly subscriptionTransport?: PushSubscriptionTransport',
  'async syncCurrentSubscription(): Promise<void>',
  'await this.subscriptionProvider.getCurrent()',
  'await this.subscriptionTransport.upsert(subscription)',
  "await this.repository.setPermission('subscribed')",
  'await this.subscriptionTransport.remove(current.endpoint)',
]) {
  expect(serviceSource.includes(text), 'NotificationService transport wiring missing ' + text);
}

for (const text of [
  'class HttpNotificationTestGateway',
  'this.subscriptions.getCurrent()',
  "this.client.post('/notifications/test'",
]) {
  expect(testGatewaySource.includes(text), 'HTTP notification test gateway missing ' + text);
}
expect(hookSource.includes('syncCurrentSubscription()'), 'notification settings hook must restore browser subscription');
expect(pwaSource.includes("document.readyState === 'complete'"), 'late PWA startup registration guard missing');
for (const text of [
  "segments[2] === 'test'",
  "active.find((item) => item.endpoint === endpoint)",
  'delivery.gateway.send(subscription',
  "error.kind === 'terminal-subscription'",
  'subscriptions.deactivateByEndpoint(endpoint)',
]) {
  expect(apiSource.includes(text), 'server test notification endpoint missing ' + text);
}

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const serviceModule = await vite.ssrLoadModule('/src/application/services/ApplicationActions.ts');
  const testGatewayModule = await vite.ssrLoadModule('/src/providers/http/HttpNotificationTestGateway.ts');

  const state = { permission: 'default', subscription: null };
  const repository = {
    async getSettings() {
      return { permission: state.permission, rules: { shiftEnd: true, etaChange: false }, subscription: state.subscription };
    },
    async setRules() {},
    async setPermission(permission) { state.permission = permission; },
    async setSubscription(subscription) { state.subscription = subscription; },
  };
  const permissionProvider = {
    async getPermission() { return 'granted'; },
    async requestPermissionFromUserGesture() { return 'granted'; },
  };
  let providerSubscription = {
    endpoint: 'https://push.example.invalid/restored',
    expirationTime: null,
    keys: { p256dh: 'restored-p256dh', auth: 'restored-auth' },
  };
  const subscriptionProvider = {
    async getCurrent() { return providerSubscription; },
    async subscribe() {
      providerSubscription = {
        endpoint: 'https://push.example.invalid/live-wiring',
        expirationTime: null,
        keys: { p256dh: 'p256dh', auth: 'auth' },
      };
      return structuredClone(providerSubscription);
    },
    async unsubscribe() { providerSubscription = null; },
  };
  const transportEvents = [];
  const subscriptionTransport = {
    async upsert(subscription) { transportEvents.push(['upsert', subscription.endpoint]); },
    async remove(endpoint) { transportEvents.push(['remove', endpoint]); },
  };
  const testGateway = { async sendTestNotification() {} };

  const service = new serviceModule.NotificationService(
    repository,
    permissionProvider,
    subscriptionProvider,
    testGateway,
    subscriptionTransport,
  );

  await service.syncCurrentSubscription();
  expect(state.permission === 'subscribed', 'existing browser subscription must restore subscribed state');
  expect(state.subscription?.endpoint === 'https://push.example.invalid/restored', 'restored subscription repository state mismatch');
  expect(
    transportEvents.some(([kind, endpoint]) => kind === 'upsert' && endpoint === 'https://push.example.invalid/restored'),
    'existing browser subscription must be re-synced to server',
  );

  await service.disablePushSubscription();
  expect(state.subscription == null, 'restored push disable must clear repository subscription');
  expect(
    transportEvents.some(([kind, endpoint]) => kind === 'remove' && endpoint === 'https://push.example.invalid/restored'),
    'restored push disable must remove server subscription',
  );

  await service.requestPermissionFromUserGesture();
  expect(state.permission === 'subscribed', 'granted browser subscription must become subscribed');
  expect(state.subscription?.endpoint === 'https://push.example.invalid/live-wiring', 'subscription repository state mismatch');
  expect(
    transportEvents.some(([kind, endpoint]) => kind === 'upsert' && endpoint === 'https://push.example.invalid/live-wiring'),
    'server subscription transport upsert was not called',
  );

  const testRequests = [];
  const testClient = {
    async post(path, body) {
      testRequests.push({ path, body: structuredClone(body) });
      return { sent: true };
    },
  };
  const realTestGateway = new testGatewayModule.HttpNotificationTestGateway(
    testClient,
    subscriptionProvider,
  );
  await realTestGateway.sendTestNotification();
  expect(testRequests.length === 1, 'real test notification gateway must send one server request');
  expect(testRequests[0]?.path === '/notifications/test', 'real test notification server path mismatch');
  expect(
    testRequests[0]?.body?.endpoint === 'https://push.example.invalid/live-wiring',
    'real test notification must target current browser subscription',
  );

  await service.disablePushSubscription();
  expect(state.subscription == null, 'disabled push must clear repository subscription');
  expect(
    transportEvents.some(([kind, endpoint]) => kind === 'remove' && endpoint === 'https://push.example.invalid/live-wiring'),
    'server subscription transport remove was not called',
  );
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('live browser push subscription wiring verification passed');
