import { buildPushPayload } from '@block65/webcrypto-web-push';
import type {
  NotificationPayload,
  PushDeliveryGateway,
  StoredPushSubscription,
} from '../contracts';
import { PushDeliveryError } from '../contracts';

export interface WebPushDeliveryConfig {
  subject: string;
  publicKey: string;
  privateKey: string;
  ttlSeconds: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
}

export interface WebPushSender {
  sendNotification(
    subscription: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    },
    payload: string,
    options: {
      vapidDetails: {
        subject: string;
        publicKey: string;
        privateKey: string;
      };
      TTL: number;
      urgency: 'very-low' | 'low' | 'normal' | 'high';
    },
  ): Promise<unknown>;
}

function requireConfig(config: WebPushDeliveryConfig): Required<WebPushDeliveryConfig> {
  const subject = config.subject.trim();
  const publicKey = config.publicKey.trim();
  const privateKey = config.privateKey.trim();
  const ttlSeconds = Math.trunc(config.ttlSeconds);
  const urgency = config.urgency ?? 'normal';

  if (!/^mailto:|^https:\/\//i.test(subject)) {
    throw new Error('VAPID subject must be a mailto: or https: URI.');
  }
  if (!publicKey || !privateKey) {
    throw new Error('VAPID key pair is required.');
  }
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 0 || ttlSeconds > 2_419_200) {
    throw new Error('Web Push TTL must be between 0 and 2419200 seconds.');
  }

  return { subject, publicKey, privateKey, ttlSeconds, urgency };
}

function statusCodeOf(error: unknown): number | null {
  if (typeof error !== 'object' || error == null || !('statusCode' in error)) return null;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' && Number.isFinite(statusCode)
    ? statusCode
    : null;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 500);
  }
  return 'Web Push delivery failed.';
}

function classifyDeliveryError(error: unknown): PushDeliveryError {
  const statusCode = statusCodeOf(error);
  const message = messageOf(error);

  const kind = statusCode === 404 || statusCode === 410
    ? 'terminal-subscription'
    : statusCode == null || statusCode === 408 ||
      statusCode === 425 || statusCode === 429 || statusCode >= 500
      ? 'transient' : 'permanent';
  return new PushDeliveryError(message, kind, statusCode);
}

/**
 * Public, privacy-safe classification of a failed upstream push request.
 * Do not forward raw provider bodies, endpoints, keys, or exception messages.
 */
export function classifyPushProviderFailure(error: unknown): {
  reason: 'PUSH_PROVIDER_BAD_REQUEST' | 'PUSH_PROVIDER_AUTH_REJECTED' |
    'PUSH_PROVIDER_RATE_LIMITED' | 'PUSH_PROVIDER_UNAVAILABLE' |
    'PUSH_TRANSPORT_ERROR' | 'PUSH_PROVIDER_REJECTED' |
    'PUSH_SUBSCRIPTION_KEY_INVALID' | 'PUSH_REQUEST_PREPARATION_FAILED' |
    'PUSH_REQUEST_HEADERS_FAILED' | 'PUSH_NETWORK_CONNECT_FAILED';
  upstreamStatus: number | null;
} {
  const raw = error instanceof PushDeliveryError ? error.providerStatus : null;
  const status = raw != null && Number.isInteger(raw) && raw >= 400 && raw <= 599
    ? raw : null;
  if (status == null) {
    const stage = error instanceof PushDeliveryError ? error.failureStage : null;
    const reason = stage === 'SUBSCRIPTION' ? 'PUSH_SUBSCRIPTION_KEY_INVALID'
      : stage === 'PREPARE' ? 'PUSH_REQUEST_PREPARATION_FAILED'
      : stage === 'HEADERS' ? 'PUSH_REQUEST_HEADERS_FAILED'
      : stage === 'FETCH' ? 'PUSH_NETWORK_CONNECT_FAILED'
      : 'PUSH_TRANSPORT_ERROR';
    return { reason, upstreamStatus: null };
  }
  if (status === 400 || status === 413 || status === 422) {
    return { reason: 'PUSH_PROVIDER_BAD_REQUEST', upstreamStatus: status };
  }
  if (status === 401 || status === 403) {
    return { reason: 'PUSH_PROVIDER_AUTH_REJECTED', upstreamStatus: status };
  }
  if (status === 429) {
    return { reason: 'PUSH_PROVIDER_RATE_LIMITED', upstreamStatus: status };
  }
  if (status >= 500 || status === 408 || status === 425) {
    return { reason: 'PUSH_PROVIDER_UNAVAILABLE', upstreamStatus: status };
  }
  return { reason: 'PUSH_PROVIDER_REJECTED', upstreamStatus: status };
}

/**
 * Both encryption (RFC 8291 aes128gcm) and VAPID JWT generation (RFC 8292)
 * MUST run on Workers-native Web Crypto, not Node's createECDH/createSign.
 * Older web-push.generateRequestDetails fails during PREPARE in workerd even
 * when outbound HTTPS is already changed to fetch().
 * Keep exactly the existing VAPID keys and D1 PushSubscription records.
 */
function validBase64UrlLength(value: string, expected: number): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=');
    return atob(padded).length === expected;
  } catch { return false; }
}

export function pushSubscriptionKeyShapeValid(keys: { p256dh: string; auth: string }): boolean {
  return validBase64UrlLength(keys.p256dh, 65) &&
    validBase64UrlLength(keys.auth, 16);
}

/**
 * Exporting just the crypto stage lets an actual local workerd (not Node)
 * exercise encryption and JWT generation with synthetic subscription keys.
 * The smoke test cannot contact any remote push service.
 */
export async function buildWorkerEncryptedPushPayload(
  subscription: Parameters<WebPushSender['sendNotification']>[0],
  payload: string,
  options: Parameters<WebPushSender['sendNotification']>[2],
): Promise<Awaited<ReturnType<typeof buildPushPayload>>> {
  if (!pushSubscriptionKeyShapeValid(subscription.keys)) {
    throw new PushDeliveryError('Push subscription key format invalid.',
      'permanent', null, 'SUBSCRIPTION');
  }
  try {
    return await buildPushPayload(
      { data: payload, options: {
        ttl: options.TTL,
        urgency: options.urgency,
      } },
      { endpoint: subscription.endpoint, expirationTime: null,
        keys: subscription.keys },
      options.vapidDetails,
    );
  } catch {
    throw new PushDeliveryError('Push encryption or VAPID signing failed.',
      'permanent', null, 'PREPARE');
  }
}

const defaultSender: WebPushSender = {
  async sendNotification(subscription, payload, options) {
    const details = await buildWorkerEncryptedPushPayload(
      subscription, payload, options);
    let url: URL;
    let headers: Headers;
    let body: ArrayBuffer | null;
    try {
      url = new URL(details.endpoint);
      if (url.protocol !== 'https:') throw new Error('HTTPS required');
      // Workers supplies forbidden transport-level headers automatically.
      headers = new Headers(details.headers as HeadersInit);
      headers.delete('content-length');
      headers.delete('host');
      body = details.body ? Uint8Array.from(details.body).buffer : null;
    } catch {
      throw new PushDeliveryError('Push outbound HTTP request setup failed.',
        'permanent', null, 'HEADERS');
    }
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new PushDeliveryError('Push outbound fetch failed.',
        'transient', null, 'FETCH');
    }
    if (!response.ok) {
      const status = response.status;
      const kind = status === 404 || status === 410
        ? 'terminal-subscription'
        : status === 408 || status === 425 || status === 429 || status >= 500
          ? 'transient' : 'permanent';
      throw new PushDeliveryError('Push provider responded with HTTP failure.',
        kind, status, 'PROVIDER');
    }
    return { statusCode: response.status };
  },
};

export class WebPushDeliveryGateway implements PushDeliveryGateway {
  private readonly config: Required<WebPushDeliveryConfig>;

  constructor(
    config: WebPushDeliveryConfig,
    private readonly sender: WebPushSender = defaultSender,
  ) {
    this.config = requireConfig(config);
  }

  async send(
    subscription: StoredPushSubscription,
    payload: NotificationPayload,
  ): Promise<void> {
    try {
      await this.sender.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
          },
        },
        JSON.stringify(payload),
        {
          vapidDetails: {
            subject: this.config.subject,
            publicKey: this.config.publicKey,
            privateKey: this.config.privateKey,
          },
          TTL: this.config.ttlSeconds,
          urgency: this.config.urgency,
        },
      );
    } catch (error) {
      if (error instanceof PushDeliveryError) throw error;
      throw classifyDeliveryError(error);
    }
  }
}
