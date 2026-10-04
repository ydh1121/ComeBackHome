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
}

export interface ScheduledControllerLike {
  cron: string;
  scheduledTime: number;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}
