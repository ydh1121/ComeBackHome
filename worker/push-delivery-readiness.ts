import { D1SubscriptionStore } from './repositories/D1SubscriptionStore';
import { WebPushDeliveryGateway } from './push/WebPushDeliveryGateway';
import type { WorkerEnv } from './runtime-types';

export type PushDeliveryMissing =
  | 'VAPID_SUBJECT' | 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY'
  | 'WEB_PUSH_TTL_SECONDS' | 'PUSH_DELIVERY_ENABLED';

export function inspectPushDeliveryConfig(env: WorkerEnv): {
  ready: boolean; missing: PushDeliveryMissing[];
} {
  const missing: PushDeliveryMissing[] = [];
  const subject = env.VAPID_SUBJECT?.trim() ?? '';
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? '';
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? '';
  const ttl = env.WEB_PUSH_TTL_SECONDS?.trim() ?? '';
  if (!/^(mailto:|https:\/\/)/i.test(subject)) missing.push('VAPID_SUBJECT');
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(publicKey)) missing.push('VAPID_PUBLIC_KEY');
  if (!privateKey) missing.push('VAPID_PRIVATE_KEY');
  if (!/^\d+$/.test(ttl) || !Number.isSafeInteger(Number(ttl)) ||
      Number(ttl) > 2419200) missing.push('WEB_PUSH_TTL_SECONDS');
  if (env.PUSH_DELIVERY_ENABLED !== '1') missing.push('PUSH_DELIVERY_ENABLED');
  return { ready: missing.length === 0, missing };
}

export function createPushDeliveryRuntime(env: WorkerEnv) {
  const inspection = inspectPushDeliveryConfig(env);
  if (!inspection.ready) return { ...inspection, gateway: null, subscriptions: null };
  return {
    ready: true as const,
    missing: [] as PushDeliveryMissing[],
    gateway: new WebPushDeliveryGateway({
      subject: env.VAPID_SUBJECT!.trim(),
      publicKey: env.VAPID_PUBLIC_KEY!.trim(),
      privateKey: env.VAPID_PRIVATE_KEY!.trim(),
      ttlSeconds: Number(env.WEB_PUSH_TTL_SECONDS),
    }),
    subscriptions: new D1SubscriptionStore(env.DB),
  };
}
