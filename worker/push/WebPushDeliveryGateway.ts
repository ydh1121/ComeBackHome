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

  if (statusCode === 404 || statusCode === 410) {
    return new PushDeliveryError(message, 'terminal-subscription');
  }
  if (
    statusCode == null ||
    statusCode === 408 ||
    statusCode === 425 ||
    statusCode === 429 ||
    statusCode >= 500
  ) {
    return new PushDeliveryError(message, 'transient');
  }
  return new PushDeliveryError(message, 'permanent');
}

const defaultSender: WebPushSender = {
  sendNotification(subscription, payload, options) {
    return webPush.sendNotification(subscription, payload, options);
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
