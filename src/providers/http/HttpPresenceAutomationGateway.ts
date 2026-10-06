import type { PresenceAutomationGateway } from '../../application/contracts/providers';

export class HttpPresenceAutomationGateway implements PresenceAutomationGateway {
  constructor(private readonly basePath = '/api') {}

  async getStatus(): Promise<{ configured: boolean }> {
    const response = await fetch(this.basePath + '/presence-events/status', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => null) as { configured?: unknown } | null;
    if (!response.ok || typeof payload?.configured !== 'boolean') {
      throw new Error('Presence automation status could not be loaded.');
    }
    return { configured: payload.configured };
  }

  async validateToken(token: string): Promise<boolean> {
    const normalized = token.trim();
    if (!normalized) return false;

    const response = await fetch(this.basePath + '/presence-events/validate', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer ' + normalized,
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
      body: '{}',
    });

    if (response.status === 401 || response.status === 503) return false;
    const payload = await response.json().catch(() => null) as { valid?: unknown } | null;
    return response.ok && payload?.valid === true;
  }
}
