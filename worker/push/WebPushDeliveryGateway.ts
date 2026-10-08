import webPush from 'web-push';
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
    'PUSH_TRANSPORT_ERROR' | 'PUSH_PROVIDER_REJECTED';
  upstreamStatus: number | null;
} {
  const raw = error instanceof PushDeliveryError ? error.providerStatus : null;
  const status = raw != null && Number.isInteger(raw) && raw >= 400 && raw <= 599
    ? raw : null;
  if (status == null) return { reason: 'PUSH_TRANSPORT_ERROR', upstreamStatus: null };
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
 * web-push implements transport with Node's https.request(). Workers' native
 * fetch() is the supported outbound HTTP path: use web-push only for standards-
 * compliant aes128gcm encryption and VAPID request construction.
 * Preserve the same VAPID keys and browser subscriptions.
 */
const defaultSender: WebPushSender = {
  async sendNotification(subscription, payload, options) {
    const details = webPush.generateRequestDetails(subscription, payload, {
      ...options,
      contentEncoding: 'aes128gcm',
    });
    const url = new URL(details.endpoint);
    if (url.protocol !== 'https:') {
      throw new Error('Push endpoint must use HTTPS.');
    }

    // fetch() sets Content-Length from the actual body. Do not forward Node's
    // transport-level headers, which Workers fetch forbids setting explicitly.
    const headers = new Headers(details.headers as HeadersInit);
    headers.delete('content-length');
    headers.delete('host');
    const body = details.body ? Uint8Array.from(details.body).buffer : null;

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      // Preserve only the HTTP status for public classification. Never echo
      // the upstream body, endpoint, auth header or subscription encryption keys.
      const failure = new Error('Push provider returned an unsuccessful HTTP status') as
        Error & { statusCode: number };
      failure.statusCode = response.status;
      throw failure;
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
      throw classifyDeliveryError(error);
    }
  }
}
