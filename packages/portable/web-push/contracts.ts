export interface WebPushSubscriptionRecord {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}

export type PushDeliveryErrorKind = 'transient' | 'terminal-subscription' | 'permanent';
export type PushDeliveryFailureStage = 'SUBSCRIPTION' | 'PREPARE' | 'HEADERS' | 'FETCH' | 'PROVIDER';

export class PushDeliveryError extends Error {
  constructor(
    message: string,
    readonly kind: PushDeliveryErrorKind,
    /** Upstream push provider HTTP status, if present. Never an endpoint or response body. */
    readonly providerStatus: number | null = null,
    readonly failureStage: PushDeliveryFailureStage | null = null,
  ) {
    super(message);
    this.name = 'PushDeliveryError';
  }
}

export interface PushDeliveryGateway { send(subscription: WebPushSubscriptionRecord, payload: object): Promise<void>; }
export interface WebPushClientConfig { applicationServerKey: string | null; }
