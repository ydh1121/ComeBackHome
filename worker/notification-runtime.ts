import type {
  NotificationEtaSource,
  NotificationRetryPolicy,
  PushDeliveryGateway,
} from './contracts';
import type { WorkerEnv } from './runtime-types';
import type { ScheduledNotificationDependencies } from './scheduler';
import { D1NotificationJobStore } from './repositories/D1NotificationJobStore';
import { D1NotificationPlannerStateStore } from './repositories/D1NotificationPlannerStateStore';
import { D1NotificationSettingsStore } from './repositories/D1NotificationSettingsStore';
import { D1PersonRepository } from './repositories/D1PersonRepository';
import { D1ScheduleRepository } from './repositories/D1ScheduleRepository';
import { D1SubscriptionStore } from './repositories/D1SubscriptionStore';

export interface NotificationRuntimeInjections {
  etaSource: NotificationEtaSource;
  gateway: PushDeliveryGateway;
  retryPolicy: NotificationRetryPolicy;
  batchSize?: number;
}

export function createD1ScheduledNotificationDependencies(
  env: WorkerEnv,
  injections: NotificationRuntimeInjections,
): ScheduledNotificationDependencies {
  const jobs = new D1NotificationJobStore(env.DB);

  return {
    planner: {
      jobs,
      settings: new D1NotificationSettingsStore(env.DB),
      plannerState: new D1NotificationPlannerStateStore(env.DB),
      people: new D1PersonRepository(env.DB),
      schedules: new D1ScheduleRepository(env.DB),
      etaSource: injections.etaSource,
    },
    outbox: {
      jobs,
      subscriptions: new D1SubscriptionStore(env.DB),
      gateway: injections.gateway,
      retryPolicy: injections.retryPolicy,
      ...(injections.batchSize == null ? {} : { batchSize: injections.batchSize }),
    },
  };
}
