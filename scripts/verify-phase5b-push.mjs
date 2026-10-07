import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const failures = [];

const models = await read('../src/domain/models.ts');
const providers = await read('../src/application/contracts/providers.ts');
const repositories = await read('../src/application/contracts/repositories.ts');
const actions = await read('../src/application/contracts/actions.ts');
const service = await read('../src/application/services/ApplicationActions.ts');
const mocks = await read('../src/mocks/providers.ts');
const mockRepositories = await read('../src/mocks/repositories.ts');
const state = await read('../src/mocks/state.ts');
const composition = await read('../src/app/composition.ts');
const mockComposition = await read('../src/app/mockComposition.ts');
const page = await read('../src/pages/NotificationPage.tsx');
const sw = await read('../public/sw.js');

for (const text of ['interface WebPushSubscriptionRecord','endpoint: string','p256dh: string','auth: string']) {
  if (!models.includes(text)) failures.push('normalized subscription model missing ' + text);
}
if (providers.includes('Promise<PushSubscription')) failures.push('DOM PushSubscription leaked into provider contract');
for (const text of ['Promise<WebPushSubscriptionRecord | null>','Promise<WebPushSubscriptionRecord>','unsubscribe(): Promise<void>']) {
  if (!providers.includes(text)) failures.push('push provider contract missing ' + text);
}
if (!repositories.includes('setSubscription(subscription: WebPushSubscriptionRecord | null)')) failures.push('subscription repository boundary missing');
if (!actions.includes('disablePushSubscription(): Promise<void>')) failures.push('unsubscribe action boundary missing');

for (const text of [
  'private readonly subscriptionProvider: PushSubscriptionProvider',
  'const subscription = await this.subscriptionProvider.subscribe()',
  'await this.repository.setSubscription(subscription)',
  "await this.repository.setPermission('subscribed')",
  'await this.subscriptionProvider.unsubscribe()',
]) {
  if (!service.includes(text)) failures.push('NotificationService subscription flow missing ' + text);
}

for (const text of ['class MockPushSubscriptionProvider','push.example.invalid/mock-subscription','mock-p256dh','mock-auth']) {
  if (!mocks.includes(text)) failures.push('mock subscription provider missing ' + text);
}
if (!mockRepositories.includes('setSubscription(subscription: WebPushSubscriptionRecord | null)')) failures.push('mock subscription persistence missing');
if (!state.includes('subscription: null')) failures.push('empty subscription fixture missing');
if (!mockComposition.includes('new MockPushSubscriptionProvider()')) failures.push('DEV mock subscription provider not composed');
if (composition.includes('MockPushSubscriptionProvider')) failures.push('mock push provider leaked into production composition');

for (const text of [
  "self.addEventListener('push'",
  'parsePushPayload(event)',
  'self.registration.showNotification',
  "self.addEventListener('notificationclick'",
  'safeNotificationPath',
  "self.clients.matchAll({ type: 'window', includeUncontrolled: true })",
  'self.clients.openWindow(path)',
]) {
  if (!sw.includes(text)) failures.push('service worker notification contract missing ' + text);
}
if (!sw.includes("icon: '/icons/icon-192.png'")) failures.push('notification icon missing');
if (!sw.includes("data: { path: payload.path }")) failures.push('notification click path data missing');

for (const forbidden of ['applicationServerKey','VAPID','/api/push','/api/subscription','fetch(\'/push','fetch("/push']) {
  if (service.includes(forbidden) || composition.includes(forbidden) || sw.includes(forbidden) || mocks.includes(forbidden)) {
    failures.push('live push/server integration leaked: ' + forbidden);
  }
}
if (page.includes('/mocks/') || page.includes('/providers/') || page.includes('contracts/repositories')) failures.push('notification page imports infrastructure');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5B push boundary verification passed');
