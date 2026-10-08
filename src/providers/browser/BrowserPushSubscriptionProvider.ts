import type { PushSubscriptionProvider } from '../../application/contracts/providers';
import type { WebPushSubscriptionRecord } from '../../domain/models';
import type { WebPushClientConfig } from '../../config/webPush';

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const raw = atob(padded);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function normalizeSubscription(subscription: PushSubscription): WebPushSubscriptionRecord {
  return subscription.toJSON() as WebPushSubscriptionRecord;
}

export class BrowserPushSubscriptionProvider implements PushSubscriptionProvider {
  constructor(private readonly config: WebPushClientConfig) {}

  async getCurrent(): Promise<WebPushSubscriptionRecord | null> {
    const registration = await this.getRegistration();
    const current = await registration.pushManager.getSubscription();
    return current ? normalizeSubscription(current) : null;
  }

  async isCompatible(): Promise<boolean> {
    const current = await (await this.getRegistration()).pushManager.getSubscription();
    if (!current || !this.config.applicationServerKey) return !current;
    const actualKey = current.options?.applicationServerKey;
    if (!actualKey) return true; // Unknown is not evidence of key rotation.
    const expected = decodeBase64Url(this.config.applicationServerKey);
    const actual = new Uint8Array(actualKey);
    return actual.length === expected.length &&
      actual.every((value, index) => value === expected[index]);
  }

  async subscribe(): Promise<WebPushSubscriptionRecord> {
    if (!this.config.applicationServerKey) throw new Error('Web Push client config is not ready.');

    const registration = await this.getRegistration();
    const current = await registration.pushManager.getSubscription();
    if (current) return normalizeSubscription(current);

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(this.config.applicationServerKey),
    });
    return normalizeSubscription(subscription);
  }

  async unsubscribe(): Promise<void> {
    const registration = await this.getRegistration();
    const current = await registration.pushManager.getSubscription();
    if (current) await current.unsubscribe();
  }

  private async getRegistration(): Promise<ServiceWorkerRegistration> {
    if (!globalThis.isSecureContext) throw new Error('Secure context is required.');
    if (!('serviceWorker' in navigator)) throw new Error('Service Worker is not supported.');
    const registration = await navigator.serviceWorker.ready;
    if (!registration.pushManager) throw new Error('PushManager is not supported.');
    return registration;
  }
}
