export type D1Bindable = string | number | null | ArrayBuffer | ArrayBufferView;

export interface D1ResultLike<T = Record<string, unknown>> {
  success: boolean;
  results?: T[];
  meta?: Record<string, unknown>;
}

export interface D1AllResultLike<T> {
  results: T[];
  success?: boolean;
  meta?: Record<string, unknown>;
}

export interface D1PreparedStatementLike {
  bind(...values: D1Bindable[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1AllResultLike<T>>;
  run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatementLike[]): Promise<Array<D1ResultLike<T>>>;
}

export interface StaticAssetFetcher {
  fetch(request: Request): Promise<Response>;
}

export interface WorkerEnv {
  DB: D1DatabaseLike;
  ASSETS?: StaticAssetFetcher;
  PUSH_DELIVERY_ENABLED?: string;
  VAPID_SUBJECT?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  WEB_PUSH_TTL_SECONDS?: string;
  NOTIFICATION_RETRY_DELAYS_SECONDS?: string;
  PRESENCE_EVENT_INGEST_TOKEN?: string;
  PROVIDER_RUNTIME_ENABLED?: string;
  KAKAO_REST_API_KEY?: string;
  SEOUL_SUBWAY_API_KEY?: string;
  SEOUL_BUS_SERVICE_KEY?: string;
}

export interface ScheduledControllerLike {
  cron: string;
  scheduledTime: number;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}
