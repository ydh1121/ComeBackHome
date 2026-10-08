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
  private runtimePublicKey: string | null = null;

  constructor(
    private readonly config: WebPushClientConfig,
    private readonly resolveServerPublicKey?: () => Promise<string | null>,
  ) {}

  async prepare(): Promise<void> {
    if (!this.resolveServerPublicKey) return;
    const publicKey = (await this.resolveServerPublicKey())?.trim() ?? '';
    if (!/^[A-Za-z0-9_-]{80,100}$/.test(publicKey)) {
      throw new Error('Web Push client config is not ready.');
    }
    this.runtimePublicKey = publicKey;
  }

  private async getApplicationServerKey(): Promise<string> {
    if (this.resolveServerPublicKey && !this.runtimePublicKey) await this.prepare();
    const key = this.runtimePublicKey ?? this.config.applicationServerKey;
    if (!key) throw new Error('Web Push client config is not ready.');
    return key;
  }

  async getCurrent(): Promise<WebPushSubscriptionRecord | null> {
    const registration = await this.getRegistration();
    const current = await registration.pushManager.getSubscription();
    return current ? normalizeSubscription(current) : null;
  }

  async isCompatible(): Promise<boolean> {
    const current = await (await this.getRegistration()).pushManager.getSubscription();
    if (!current) return true;
    const publicKey = await this.getApplicationServerKey();
    const actualKey = current.options?.applicationServerKey;
    if (!actualKey) return true; // Unknown is not evidence of key rotation.
    const expected = decodeBase64Url(publicKey);
    const actual = new Uint8Array(actualKey);
    return actual.length === expected.length &&
      actual.every((value, index) => value === expected[index]);
  }

  async subscribe(): Promise<WebPushSubscriptionRecord> {
    const publicKey = await this.getApplicationServerKey();

    const registration = await this.getRegistration();
    const current = await registration.pushManager.getSubscription();
    if (current) return normalizeSubscription(current);

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(publicKey),
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
