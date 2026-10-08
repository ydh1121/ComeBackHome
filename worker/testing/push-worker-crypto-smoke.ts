import { buildWorkerEncryptedPushPayload } from '../push/WebPushDeliveryGateway';

/**
 * Offline-only local workerd cryptographic smoke. This entry is never routed
 * from /functions or imported by the production bundle. No outbound fetches.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/smoke') {
      return new Response(null, { status: 404 });
    }
    try {
      const input = await request.json() as {
        endpoint: string;
        p256dh: string;
        auth: string;
        vapidSubject: string;
        vapidPublic: string;
        vapidPrivate: string;
      };
      if (new URL(input.endpoint).hostname !== 'web.push.apple.com') {
        return Response.json({ ok: false, stage: 'INVALID_FIXTURE' }, { status: 400 });
      }
      const requestParts = await buildWorkerEncryptedPushPayload(
        { endpoint: input.endpoint, keys: { p256dh: input.p256dh, auth: input.auth } },
        JSON.stringify({ title: 'CI Only', body: 'Synthetic encrypted payload',
          tag: 'ci-only', path: '/notifications' }),
        { vapidDetails: { subject: input.vapidSubject,
            publicKey: input.vapidPublic, privateKey: input.vapidPrivate },
          TTL: 300, urgency: 'normal' },
      );
      const headers = new Headers(requestParts.headers as HeadersInit);
      const raw = requestParts.body;
      const bytes = new Uint8Array(raw as ArrayBuffer);
      const plaintext = new TextEncoder().encode('Synthetic encrypted payload');
      const containsPlaintext = bytes.some((_value, i) =>
        i + plaintext.length <= bytes.length &&
        plaintext.every((byte, j) => bytes[i + j] === byte));
      return Response.json({
        ok: headers.get('content-encoding') === 'aes128gcm' &&
          headers.get('ttl') === '300' &&
          bytes.length > 100 && !containsPlaintext,
        contentEncoding: headers.get('content-encoding'),
        ttl: headers.get('ttl'),
        bodyLength: bytes.length,
        encrypted: !containsPlaintext,
        authorization: headers.get('authorization'),
      });
    } catch (error) {
      const stage = error && typeof error === 'object' && 'failureStage' in error
        ? String((error as { failureStage?: string }).failureStage) : 'RUNTIME';
      // Do not return raw errors, VAPID material, subscription URL or keys.
      return Response.json({ ok: false, stage }, { status: 500 });
    }
  },
};
