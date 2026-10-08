import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import webPush from 'web-push';
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
  "import { buildPushPayload } from '@block65/webcrypto-web-push'",
  'class WebPushDeliveryGateway',
  'buildWorkerEncryptedPushPayload',
  'return await buildPushPayload',
  'response = await fetch(url.toString()',
  'vapidDetails:',
  'TTL: this.config.ttlSeconds',
  "statusCode === 404 || statusCode === 410",
  "statusCode === 429",
  'new PushDeliveryError(message, kind, statusCode)',
  'export function classifyPushProviderFailure',
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
      const diagnosed = module.classifyPushProviderFailure(error);
      const expectedReason = statusCode === 400 ? 'PUSH_PROVIDER_BAD_REQUEST'
        : statusCode === 401 || statusCode === 403 ? 'PUSH_PROVIDER_AUTH_REJECTED'
        : statusCode === 429 ? 'PUSH_PROVIDER_RATE_LIMITED'
        : statusCode === 503 ? 'PUSH_PROVIDER_UNAVAILABLE'
        : statusCode === 404 || statusCode === 410 ? 'PUSH_PROVIDER_REJECTED'
        : 'PUSH_TRANSPORT_ERROR';
      expect(diagnosed.reason === expectedReason,
        'status ' + String(statusCode) + ' public reason incorrect');
      expect(diagnosed.upstreamStatus === statusCode,
        'status ' + String(statusCode) + ' must retain only sanitized HTTP status');
      expect(!JSON.stringify(diagnosed).includes(subscription.endpoint),
        'public error must never include subscription endpoint');
    }
  };

  await expectKind(410, 'terminal-subscription');
  await expectKind(404, 'terminal-subscription');
  await expectKind(401, 'permanent');
  await expectKind(403, 'permanent');
  await expectKind(429, 'transient');
  await expectKind(503, 'transient');
  await expectKind(null, 'transient');
  await expectKind(400, 'permanent');

  const unknownRuntimeFailure = module.classifyPushProviderFailure(new Error('secret runtime path'));
  expect(unknownRuntimeFailure.reason === 'PUSH_TRANSPORT_ERROR' &&
    unknownRuntimeFailure.upstreamStatus === null,
    'runtime errors must not be mislabeled as upstream provider refusal');
  expect(!JSON.stringify(unknownRuntimeFailure).includes('secret runtime path'),
    'raw runtime exception must not leak to client');

  // Exercise the PRODUCTION default sender, not only an injected mock.
  // A valid ephemeral P-256 client public key forces real aes128gcm encryption
  // and VAPID signing. Fetch interception guarantees ZERO external sends.
  const receiver=createECDH('prime256v1');
  receiver.generateKeys();
  const validKeys=webPush.generateVAPIDKeys();
  const actualSubscription={
    ...subscription,
    endpoint:'https://web.push.apple.com/Q/example-test-only',
    keys:{
      p256dh:receiver.getPublicKey().toString('base64url'),
      auth:randomBytes(16).toString('base64url'),
    },
  };
  const nativeGateway=new module.WebPushDeliveryGateway({
    subject:'mailto:test@example.invalid',
    publicKey:validKeys.publicKey,
    privateKey:validKeys.privateKey,
    ttlSeconds:300,
  });
  const fetchOriginal=globalThis.fetch;
  const outbound=[];
  try {
    globalThis.fetch=async (url, init) => {
      outbound.push({
        url:String(url),method:init.method,
        authorization:init.headers.get('Authorization'),
        encoding:init.headers.get('Content-Encoding'),
        ttl:init.headers.get('TTL'),
        bodyBytes:init.body?.byteLength??0,
        contentLength:init.headers.get('Content-Length'),
      });
      return new Response(null,{status:201});
    };
    await nativeGateway.send(actualSubscription,payload);
    assert.equal(outbound.length,1,'default sender must use native fetch');
    assert.equal(outbound[0].url,actualSubscription.endpoint);
    assert.equal(outbound[0].method,'POST');
    assert.equal(outbound[0].encoding,'aes128gcm','iPhone requires RFC8291 aes128gcm');
    assert.equal(outbound[0].ttl,'300');
    assert.ok(outbound[0].authorization?.startsWith('vapid '));
    assert.ok(outbound[0].bodyBytes>40,'payload must be encrypted');
    assert.equal(outbound[0].contentLength,null,
      'native fetch must set Content-Length itself');
    globalThis.fetch=async () => new Response(null,{status:403});
    await assert.rejects(nativeGateway.send(actualSubscription,payload),error =>
      error?.kind==='permanent' && error.providerStatus===403);
    globalThis.fetch=async () => { throw new TypeError('mock transport failure'); };
    await assert.rejects(nativeGateway.send(actualSubscription,payload),error =>
      error?.kind==='transient' && error.providerStatus===null);
  } finally {
    globalThis.fetch=fetchOriginal;
  }
  console.log(JSON.stringify({
    nativeFetchEncryptedSend:true,
    vapidSigned:true,
    upstreamStatusPropagated:true,
    transportFailureClassified:true,
    actualPushSends:0,
  }));

  // Isolate actual default-sender failure stage without a network request.
  const stageCases = [
    {
      name:'invalid subscription', keys:{p256dh:'wrong',auth:'wrong'},
      status:'PUSH_SUBSCRIPTION_KEY_INVALID',
    },
  ];
  for (const item of stageCases) {
    const malformed={...actualSubscription,keys:item.keys};
    await assert.rejects(nativeGateway.send(malformed,payload),error =>
      module.classifyPushProviderFailure(error).reason===item.status);
  }
  const mockedOriginal=globalThis.fetch;
  try {
    globalThis.fetch=async () => { throw new TypeError('Synthetic fetch failed'); };
    await assert.rejects(nativeGateway.send(actualSubscription,payload),error =>
      error?.failureStage==='FETCH' &&
      module.classifyPushProviderFailure(error).reason==='PUSH_NETWORK_CONNECT_FAILED');
    globalThis.fetch=async () => new Response(null,{status:403});
    await assert.rejects(nativeGateway.send(actualSubscription,payload),error =>
      error?.failureStage==='PROVIDER' &&
      module.classifyPushProviderFailure(error).reason==='PUSH_PROVIDER_AUTH_REJECTED');
  } finally {
    globalThis.fetch=mockedOriginal;
  }

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
