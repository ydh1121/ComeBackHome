import type { PresenceRepository } from '../../application/contracts/repositories';
import type { PresenceState } from '../../domain/models';
import { HttpJsonClient } from './HttpJsonClient';

export class HttpPresenceRepository implements PresenceRepository {
  constructor(private readonly client: HttpJsonClient) {}

  async get(personId: string): Promise<PresenceState | null> {
    return (await this.client.get<{ presence: PresenceState | null }>(
      '/people/' + encodeURIComponent(personId) + '/presence',
    )).presence;
  }

  async record(): Promise<{ state: PresenceState; duplicate: boolean }> {
    throw new Error('Presence events must be recorded through the trusted automation endpoint.');
  }
}
