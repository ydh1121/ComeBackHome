export interface JsonReadCache {
  read<T>(key: string, path: string, read: () => Promise<T>): Promise<T>;
  invalidate(): void;
}

export class HttpApiError extends Error {
  constructor(message: string, readonly status: number, readonly reason: string | null) {
    super(message);
    this.name = 'HttpApiError';
  }
}

export class JsonHttpClient {
  constructor(
    private readonly basePath = '/api',
    private readonly onMutation: () => void = () => undefined,
    private readonly readCache?: JsonReadCache,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  get<T>(path: string): Promise<T> {
    const read = () => this.request<T>(path, { method: 'GET' });
    return this.readCache ? this.readCache.read(this.basePath + path, path, read) : read();
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
  }

  delete<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', body: JSON.stringify(body) });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    if (!path.startsWith('/')) throw new Error('HTTP API path must start with /.');

    const response = await this.fetcher(this.basePath + path, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      credentials: 'same-origin',
    });

    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const message = typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : 'HTTP request failed with status ' + response.status + '.';
      const reason = typeof payload === 'object' && payload !== null &&
        'reason' in payload && typeof payload.reason === 'string' ? payload.reason : null;
      throw new HttpApiError(message, response.status, reason);
    }

    if ((init.method ?? 'GET') !== 'GET') { this.readCache?.invalidate(); this.onMutation(); }
    return payload as T;
  }
}
