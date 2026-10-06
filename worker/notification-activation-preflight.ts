import {
  inspectNotificationActivationConfig,
  type NotificationActivationRequirement,
} from './notification-activation-readiness';
import type { WorkerEnv } from './runtime-types';

export type NotificationOperationalRequirement =
  | 'PRESENCE_EVENT_INGEST_TOKEN'
  | 'PUSH_DELIVERY_ENABLED'
  | 'PROVIDER_RUNTIME_ENABLED'
  | 'LIVE_SCHEDULER_WIRING'
  | 'REMOTE_D1_MIGRATIONS'
  | 'CLOUDFLARE_CRON'
  | 'SAME_ORIGIN_DEPLOYMENT';

export interface NotificationActivationPreflightOptions {
  schedulerWired?: boolean;
  remoteD1MigrationsApplied?: boolean;
  cronConfigured?: boolean;
  sameOriginDeploymentConfigured?: boolean;
}

export interface NotificationActivationPreflight {
  status: 'READY' | 'BLOCKED';
  configMissing: NotificationActivationRequirement[];
  operationsPending: NotificationOperationalRequirement[];
  secretPresence: {
    vapidSubject: boolean;
    vapidPublicKey: boolean;
    vapidPrivateKey: boolean;
    kakaoRestApiKey: boolean;
    presenceEventIngestToken: boolean;
  };
  valuesExposed: false;
}

function present(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function evaluateNotificationActivationPreflight(
  env: WorkerEnv,
  options: NotificationActivationPreflightOptions = {},
): NotificationActivationPreflight {
  const providerRuntimeEnabled = env.PROVIDER_RUNTIME_ENABLED === '1';
  const config = inspectNotificationActivationConfig(env, providerRuntimeEnabled);
  const operationsPending: NotificationOperationalRequirement[] = [];

  if (!present(env.PRESENCE_EVENT_INGEST_TOKEN)) {
    operationsPending.push('PRESENCE_EVENT_INGEST_TOKEN');
  }
  if (env.PUSH_DELIVERY_ENABLED !== '1') {
    operationsPending.push('PUSH_DELIVERY_ENABLED');
  }
  if (!providerRuntimeEnabled) {
    operationsPending.push('PROVIDER_RUNTIME_ENABLED');
  }
  if (options.schedulerWired !== true) {
    operationsPending.push('LIVE_SCHEDULER_WIRING');
  }
  if (options.remoteD1MigrationsApplied !== true) {
    operationsPending.push('REMOTE_D1_MIGRATIONS');
  }
  if (options.cronConfigured !== true) {
    operationsPending.push('CLOUDFLARE_CRON');
  }
  if (options.sameOriginDeploymentConfigured !== true) {
    operationsPending.push('SAME_ORIGIN_DEPLOYMENT');
  }

  return {
    status:
      config.missing.length === 0 && operationsPending.length === 0
        ? 'READY'
        : 'BLOCKED',
    configMissing: config.missing,
    operationsPending,
    secretPresence: {
      vapidSubject: present(env.VAPID_SUBJECT),
      vapidPublicKey: present(env.VAPID_PUBLIC_KEY),
      vapidPrivateKey: present(env.VAPID_PRIVATE_KEY),
      kakaoRestApiKey: present(env.KAKAO_REST_API_KEY),
      presenceEventIngestToken: present(env.PRESENCE_EVENT_INGEST_TOKEN),
    },
    valuesExposed: false,
  };
}
