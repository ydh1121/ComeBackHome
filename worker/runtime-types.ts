import type { D1DatabaseLike, StaticAssetFetcher } from '../packages/portable/d1/types';
import type { PrivateEnv } from './modules/auth/contracts';
export * from '../packages/portable/d1/types';

export interface WorkerEnv extends PrivateEnv {
  DB: D1DatabaseLike;
  ASSETS?: StaticAssetFetcher;
  MUTATIONS_ENABLED?: string;
  PUSH_DELIVERY_ENABLED?: string;
  VAPID_SUBJECT?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  WEB_PUSH_TTL_SECONDS?: string;
  NOTIFICATION_RETRY_DELAYS_SECONDS?: string;
  PRESENCE_EVENT_INGEST_TOKEN?: string;
  PROVIDER_RUNTIME_ENABLED?: string;
  KAKAO_REST_API_KEY?: string;
  CBH_KAKAO_MAPS_JAVASCRIPT_KEY?: string;
  KAKAO_JAVASCRIPT_KEY?: string;
  VITE_CBH_KAKAO_JAVASCRIPT_KEY?: string;
  SEOUL_BUS_SERVICE_KEY?: string;
  SEOUL_OPENAPI_KEY?: string;
  SEOUL_SUBWAY_API_KEY?: string;
}

export interface ScheduledControllerLike {
  cron: string;
  scheduledTime: number;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}


export interface SchedulerWorkerEnv {
  PAGES_ORIGIN?: string;
  PRESENCE_EVENT_INGEST_TOKEN?: string;
}
