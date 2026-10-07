import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const failures = [];

const config = await read('../src/config/webPush.ts');
const browser = await read('../src/providers/browser/BrowserPushSubscriptionProvider.ts');
const providers = await read('../src/application/contracts/providers.ts');
const composition = await read('../src/app/composition.ts');
const mockComposition = await read('../src/app/mockComposition.ts');
const browserRuntime = await read('../src/app/browserNotificationRuntime.ts');
const service = await read('../src/application/services/ApplicationActions.ts');

for (const text of [
  'interface WebPushClientConfig',
  'applicationServerKey: string | null',
  'UNCONFIGURED_WEB_PUSH_CLIENT_CONFIG',
  'applicationServerKey: null',
  'createWebPushClientConfig',
]) {
  if (!config.includes(text)) failures.push('push config missing ' + text);
}

for (const text of [
  'class BrowserPushSubscriptionProvider',
  'navigator.serviceWorker.ready',
  'registration.pushManager.getSubscription()',
  'registration.pushManager.subscribe({',
  'userVisibleOnly: true',
  'applicationServerKey: decodeBase64Url',
  'current.unsubscribe()',
  'globalThis.isSecureContext',
]) {
  if (!browser.includes(text)) failures.push('browser push adapter missing ' + text);
}
if (!browser.includes('subscription.toJSON() as WebPushSubscriptionRecord')) failures.push('browser subscription normalization missing');

for (const text of [
  'interface PushSubscriptionTransport',
  'upsert(subscription: WebPushSubscriptionRecord): Promise<void>',
  'remove(endpoint: string): Promise<void>',
]) {
  if (!providers.includes(text)) failures.push('subscription transport contract missing ' + text);
}

if (!browserRuntime.includes('BrowserPushSubscriptionProvider')) failures.push('production browser push adapter wiring missing');
if (!composition.includes('createBrowserNotificationRuntime(client)')) failures.push('production notification runtime composition missing');
if (!mockComposition.includes('new MockPushSubscriptionProvider()')) failures.push('DEV mock push provider is no longer active');
if (composition.includes('MockPushSubscriptionProvider')) failures.push('mock push provider leaked into production composition');
if (!service.includes('private readonly subscriptionProvider: PushSubscriptionProvider')) failures.push('application subscription boundary missing');

const forbidden = [
  'VITE_WEB_PUSH',
  'VITE_VAPID',
  'applicationServerKey: \'B',
  'applicationServerKey: "B',
  '/api/push',
  '/api/subscription',
  'fetch(',
];
for (const text of forbidden) {
  if (config.includes(text) || browser.includes(text)) failures.push('live key/server transport leaked: ' + text);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('phase 5C browser push boundary verification passed');
