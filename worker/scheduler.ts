import type {
  NotificationJob,
  NotificationJobStore,
  NotificationRetryPolicy,
  PushDeliveryGateway,
  SubscriptionStore,
} from './contracts';
import { PushDeliveryError } from './contracts';
import type { WorkerEnv } from './runtime-types';
import { planNotificationJobs } from './notification-planner';
import type { NotificationPlanResult, NotificationPlannerDependencies } from './notification-planner';

export interface NotificationOutboxDependencies {
  jobs: NotificationJobStore;
  subscriptions: SubscriptionStore;
  gateway: PushDeliveryGateway;
  retryPolicy: NotificationRetryPolicy;
  batchSize?: number;
}

export interface ScheduledNotificationDependencies {
  planner: NotificationPlannerDependencies;
  outbox: NotificationOutboxDependencies;
}

export interface ScheduledNotificationCycleResult {
  status: 'disabled' | 'not-configured' | 'processed';
  scheduledAt: string;
  planning: NotificationPlanResult | null;
  planningError: string | null;
  delivery: SchedulerRunResult;
}

export interface SchedulerRunResult {
  status: 'disabled' | 'not-configured' | 'processed';
  scheduledAt: string;
  claimed: number;
  sent: number;
  retry: number;
  failed: number;
  deactivated: number;
}

function emptyResult(
  status: SchedulerRunResult['status'],
  scheduledAt: string,
): SchedulerRunResult {
  return {
    status,
    scheduledAt,
    claimed: 0,
    sent: 0,
    retry: 0,
    failed: 0,
    deactivated: 0,
  };
}

function safeError(error: unknown): Error {
  if (error instanceof Error) {
    const message = error.message.trim().slice(0, 500) || 'Push delivery failed.';
    return new Error(message);
  }
  return new Error('Push delivery failed.');
}

async function applyRetryOrFailure(
  job: NotificationJob,
  error: Error,
  now: Date,
  dependencies: NotificationOutboxDependencies,
  result: SchedulerRunResult,
): Promise<void> {
  const nextAttemptAt = dependencies.retryPolicy.nextAttempt(job, error, now);
  if (nextAttemptAt) {
    await dependencies.jobs.markRetry(job.id, nextAttemptAt, error.message);
    result.retry += 1;
    return;
  }

  await dependencies.jobs.markFailed(job.id, error.message);
  result.failed += 1;
}

export async function processNotificationOutbox(
  dependencies: NotificationOutboxDependencies,
  scheduledTime: number,
): Promise<SchedulerRunResult> {
  const now = new Date(scheduledTime);
  const scheduledAt = now.toISOString();
  const result = emptyResult('processed', scheduledAt);
  const jobs = await dependencies.jobs.claimDue(
    scheduledAt,
    dependencies.batchSize ?? 20,
  );
  result.claimed = jobs.length;

  for (const job of jobs) {
    const activeSubscriptions = await dependencies.subscriptions.listActive();
    if (!activeSubscriptions.length) {
      await applyRetryOrFailure(
        job,
        new Error('No active push subscription.'),
        now,
        dependencies,
        result,
      );
      continue;
    }

    let delivered = 0;
    let retryError: Error | null = null;
    let permanentError: Error | null = null;

    for (const subscription of activeSubscriptions) {
      try {
        await dependencies.gateway.send(subscription, job.payload);
        delivered += 1;
      } catch (error) {
        if (error instanceof PushDeliveryError && error.kind === 'terminal-subscription') {
          await dependencies.subscriptions.deactivateByEndpoint(subscription.endpoint);
          result.deactivated += 1;
          continue;
        }

        const normalized = safeError(error);
        if (error instanceof PushDeliveryError && error.kind === 'permanent') {
          permanentError = normalized;
          break;
        }

        retryError ??= normalized;
      }
    }

    if (permanentError) {
      await dependencies.jobs.markFailed(job.id, permanentError.message);
      result.failed += 1;
      continue;
    }

    if (retryError) {
      await applyRetryOrFailure(job, retryError, now, dependencies, result);
      continue;
    }

    if (delivered > 0) {
      await dependencies.jobs.markSent(job.id, scheduledAt);
      result.sent += 1;
      continue;
    }

    await applyRetryOrFailure(
      job,
      new Error('No valid push subscription accepted the notification.'),
      now,
      dependencies,
      result,
    );
  }

  return result;
}

export async function runScheduledTick(
  env: WorkerEnv,
  scheduledTime: number,
  dependencies?: NotificationOutboxDependencies,
): Promise<SchedulerRunResult> {
  const scheduledAt = new Date(scheduledTime).toISOString();

  if (env.PUSH_DELIVERY_ENABLED !== '1') {
    return emptyResult('disabled', scheduledAt);
  }

  if (!dependencies) {
    return emptyResult('not-configured', scheduledAt);
  }

  return processNotificationOutbox(dependencies, scheduledTime);
}


function safePlanningError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim().slice(0, 500) || 'Notification planning failed.';
  }
  return 'Notification planning failed.';
}

export async function runScheduledNotificationCycle(
  env: WorkerEnv,
  scheduledTime: number,
  dependencies?: ScheduledNotificationDependencies,
): Promise<ScheduledNotificationCycleResult> {
  const scheduledAt = new Date(scheduledTime).toISOString();

  if (env.PUSH_DELIVERY_ENABLED !== '1') {
    return {
      status: 'disabled',
      scheduledAt,
      planning: null,
      planningError: null,
      delivery: emptyResult('disabled', scheduledAt),
    };
  }

  if (!dependencies) {
    return {
      status: 'not-configured',
      scheduledAt,
      planning: null,
      planningError: null,
      delivery: emptyResult('not-configured', scheduledAt),
    };
  }

  let planning: NotificationPlanResult | null = null;
  let planningError: string | null = null;

  try {
    planning = await planNotificationJobs(dependencies.planner, scheduledTime);
  } catch (error) {
    planningError = safePlanningError(error);
  }

  const delivery = await processNotificationOutbox(
    dependencies.outbox,
    scheduledTime,
  );

  return {
    status: 'processed',
    scheduledAt,
    planning,
    planningError,
    delivery,
  };
}
