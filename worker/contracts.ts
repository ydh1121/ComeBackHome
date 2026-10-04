import type { WebPushSubscriptionRecord } from '../src/domain/models';

export const BACKEND_ARCHITECTURE = {
  deploymentName: 'come-back-home',
  runtime: 'cloudflare-workers',
  frontend: 'workers-static-assets',
  apiPrefix: '/api',
  database: 'cloudflare-d1',
  databaseName: 'come-back-home-db',
  databaseBinding: 'DB',
  databaseLocationHint: 'apac',
  scheduler: 'cron-trigger',
  schedulerExpression: '* * * * *',
  persistedTimestampZone: 'UTC',
  productTimezone: 'Asia/Seoul',
  queue: 'deferred',
  durableObjects: 'not-used',
  access: 'cloudflare-access-private-app',
} as const;

export type NotificationJobStatus = 'pending' | 'processing' | 'sent' | 'retry' | 'failed' | 'cancelled';

export interface StoredPushSubscription extends WebPushSubscriptionRecord {
  id: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationPayload {
  title: string;
  body: string;
  tag: string;
  path: string;
}

export interface NotificationJob {
  id: string;
  dedupeKey: string;
  personId: string | null;
  type: string;
  scheduledFor: string;
  nextAttemptAt: string;
  status: NotificationJobStatus;
  attempts: number;
  payload: NotificationPayload;
  sentAt: string | null;
  lastError: string | null;
}

export interface SubscriptionStore {
  upsert(subscription: WebPushSubscriptionRecord): Promise<StoredPushSubscription>;
  deactivateByEndpoint(endpoint: string): Promise<void>;
  listActive(): Promise<StoredPushSubscription[]>;
}

export interface NotificationJobStore {
  enqueueOnce(job: Omit<NotificationJob, 'status' | 'attempts' | 'sentAt' | 'lastError'>): Promise<void>;
  claimDue(nowIso: string, limit: number): Promise<NotificationJob[]>;
  markSent(jobId: string, sentAt: string): Promise<void>;
  markRetry(jobId: string, nextAttemptAt: string, error: string): Promise<void>;
  markFailed(jobId: string, error: string): Promise<void>;
}

export interface PushDeliveryGateway {
  send(subscription: StoredPushSubscription, payload: NotificationPayload): Promise<void>;
}

export interface SchedulerClock {
  now(): Date;
}

export interface BackendEnvironmentContract {
  DB: unknown;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
}
