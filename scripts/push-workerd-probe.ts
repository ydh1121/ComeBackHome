// Local-only workerd Web Push compatibility probe. Never deployed or used with user data.
// All keys, endpoints and subscriptions are ephemeral; no external push is sent.
import webPush from 'web-push';
import { Buffer } from 'node:buffer';
import { WebPushDeliveryGateway } from '../worker/push/WebPushDeliveryGateway';

export default {
  async fetch(_request: Request): Promise<Response> {
    const outputs: Record<string, unknown> = { runtime: 'workerd', actualPushSends: 0 };
    const originalFetch = globalThis.fetch;
    try {
      const receiver = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
      const p256dh = Buffer.from(await crypto.subtle.exportKey('raw', receiver.publicKey))
        .toString('base64url');
      const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
      const vapid = webPush.generateVAPIDKeys();
      const gateway = new WebPushDeliveryGateway({
        subject: 'mailto:workerd-test@example.invalid',
        publicKey: vapid.publicKey, privateKey: vapid.privateKey, ttlSeconds: 60,
      });
      const subscription = {
        id: 'fake-local',
        endpoint: 'https://push.example.invalid/no-network',
        expirationTime: null,
        keys: { p256dh, auth }, active: true,
        createdAt: '2026-10-09T00:00:00Z', updatedAt: '2026-10-09T00:00:00Z',
      };
      let intercepted = false;
      globalThis.fetch = (async (_target: RequestInfo | URL, init?: RequestInit) => {
        intercepted = true;
        const headers = new Headers(init?.headers);
        outputs.encryptedPayloadBytes = init?.body instanceof ArrayBuffer
          ? init.body.byteLength : -1;
        outputs.hasVapidAuth = (headers.get('authorization') ?? '').startsWith('vapid ');
        outputs.contentEncoding = headers.get('content-encoding');
        outputs.networkMocked = true;
        return new Response(null, { status: 201 });
      }) as typeof fetch;
      await gateway.send(subscription, {
        title: 'test', body: 'ephemeral', tag: 'test-only', path: '/',
      });
      outputs.stage = 'OK';
      outputs.intercepted = intercepted;
      if (!intercepted || !outputs.hasVapidAuth || outputs.contentEncoding !== 'aes128gcm') {
        return Response.json({ ...outputs, failure: 'INVALID_REQUEST' }, { status: 500 });
      }
      return Response.json(outputs);
    } catch (error) {
      const e = error as Error & { code?: string, providerStatus?: number };
      // Safe because all test keys are synthetic and user data is never loaded.
      return Response.json({
        ...outputs, stage: 'ERROR', errorName: e.name, errorCode: e.code ?? null,
        message: String(e.message).slice(0, 350),
      }, { status: 500 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
};
