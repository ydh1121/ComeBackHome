import {
  inspectNotificationActivationConfig,
  type NotificationActivationRequirement,
} from './notification-activation-readiness';
import type { WorkerEnv } from './runtime-types';

export type NotificationOperationalRequirement =
  | 'PRESENCE_EVENT_INGEST_TOKEN'
  | 'PUSH_DELIVERY_ENABLED'
  | 'PROVIDER_RUNTIME_ENABLED'
  | 'REMOTE_D1_MIGRATIONS'
  | 'SAME_ORIGIN_DEPLOYMENT'
  | 'PAGES_DIRECT_BINDINGS';

export interface NotificationActivationPreflightOptions {
  remoteD1MigrationsApplied?: boolean;
  sameOriginDeploymentConfigured?: boolean;
  pagesDirectBindingsConfigured?: boolean;
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
  if (options.remoteD1MigrationsApplied !== true) {
    operationsPending.push('REMOTE_D1_MIGRATIONS');
  }
  if (options.sameOriginDeploymentConfigured !== true) {
    operationsPending.push('SAME_ORIGIN_DEPLOYMENT');
  }
  if (options.pagesDirectBindingsConfigured !== true) {
    operationsPending.push('PAGES_DIRECT_BINDINGS');
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
