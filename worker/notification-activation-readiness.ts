import type { ProviderSourceBundle } from './providers/contracts';
import { createD1ProviderNotificationEtaSource } from './notification-eta-source';
import { FixedDelayNotificationRetryPolicy } from './notification-retry-policy';
import {
  createD1ScheduledNotificationDependencies,
} from './notification-runtime';
import { WebPushDeliveryGateway } from './push/WebPushDeliveryGateway';
import type { ScheduledNotificationDependencies } from './scheduler';
import type { WorkerEnv } from './runtime-types';

export type NotificationActivationRequirement =
  | 'VAPID_SUBJECT'
  | 'VAPID_PUBLIC_KEY'
  | 'VAPID_PRIVATE_KEY'
  | 'WEB_PUSH_TTL_SECONDS'
  | 'NOTIFICATION_RETRY_DELAYS_SECONDS'
  | 'KAKAO_REST_API_KEY'
  | 'PROVIDER_RUNTIME';

export type NotificationActivationReadiness =
  | {
      ready: false;
      missing: NotificationActivationRequirement[];
      dependencies: null;
    }
  | {
      ready: true;
      missing: [];
      dependencies: ScheduledNotificationDependencies;
    };

function clean(value: string | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized ? normalized : null;
}

function parseTtl(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 2_419_200
    ? parsed
    : null;
}

function parseRetryDelays(value: string): number[] | null {
  const parts = value.split(',').map((part) => part.trim());
  if (!parts.length || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) return null;
  const parsed = parts.map(Number);
  if (parsed.some((item) => !Number.isFinite(item) || item < 0)) return null;
  return parsed;
}

export interface NotificationActivationConfigInspection {
  missing: NotificationActivationRequirement[];
}

export function inspectNotificationActivationConfig(
  env: WorkerEnv,
  providerRuntimeAvailable: boolean,
): NotificationActivationConfigInspection {
  const ttlRaw = clean(env.WEB_PUSH_TTL_SECONDS);
  const retryRaw = clean(env.NOTIFICATION_RETRY_DELAYS_SECONDS);
  const missing: NotificationActivationRequirement[] = [];

  const subject = clean(env.VAPID_SUBJECT);
  if (!subject || !/^(mailto:|https:\/\/)/i.test(subject)) missing.push('VAPID_SUBJECT');
  if (!clean(env.VAPID_PUBLIC_KEY)) missing.push('VAPID_PUBLIC_KEY');
  if (!clean(env.VAPID_PRIVATE_KEY)) missing.push('VAPID_PRIVATE_KEY');
  if (!ttlRaw || parseTtl(ttlRaw) == null) missing.push('WEB_PUSH_TTL_SECONDS');
  if (!retryRaw || !parseRetryDelays(retryRaw)?.length) {
    missing.push('NOTIFICATION_RETRY_DELAYS_SECONDS');
  }
  if (!clean(env.KAKAO_REST_API_KEY)) missing.push('KAKAO_REST_API_KEY');
  if (!providerRuntimeAvailable) missing.push('PROVIDER_RUNTIME');

  return { missing };
}

export function createNotificationActivationReadiness(
  env: WorkerEnv,
  providers: ProviderSourceBundle | null,
): NotificationActivationReadiness {
  const subject = clean(env.VAPID_SUBJECT);
  const publicKey = clean(env.VAPID_PUBLIC_KEY);
  const privateKey = clean(env.VAPID_PRIVATE_KEY);
  const ttlRaw = clean(env.WEB_PUSH_TTL_SECONDS);
  const retryRaw = clean(env.NOTIFICATION_RETRY_DELAYS_SECONDS);
  const ttlSeconds = ttlRaw ? parseTtl(ttlRaw) : null;
  const retryDelaysSeconds = retryRaw ? parseRetryDelays(retryRaw) : null;

  const inspection = inspectNotificationActivationConfig(env, providers != null);

  if (
    inspection.missing.length ||
    !subject ||
    !publicKey ||
    !privateKey ||
    ttlSeconds == null ||
    !retryDelaysSeconds ||
    !providers
  ) {
    return { ready: false, missing: inspection.missing, dependencies: null };
  }

  const etaSource = createD1ProviderNotificationEtaSource(env.DB, providers);
  const gateway = new WebPushDeliveryGateway({
    subject,
    publicKey,
    privateKey,
    ttlSeconds,
  });
  const retryPolicy = new FixedDelayNotificationRetryPolicy(retryDelaysSeconds);

  return {
    ready: true,
    missing: [],
    dependencies: createD1ScheduledNotificationDependencies(env, {
      etaSource,
      gateway,
      retryPolicy,
    }),
  };
}
