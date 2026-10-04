export class HttpJsonClient {
  constructor(
    private readonly basePath = '/api',
    private readonly onMutation: () => void = () => undefined,
  ) {}

  get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
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

    const response = await fetch(this.basePath + path, {
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
      throw new Error(message);
    }

    if ((init.method ?? 'GET') !== 'GET') this.onMutation();
    return payload as T;
  }
}
