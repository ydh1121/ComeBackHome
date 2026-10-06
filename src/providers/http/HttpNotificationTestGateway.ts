import type { NotificationTestGateway, PushSubscriptionProvider } from '../../application/contracts/providers';
import { HttpJsonClient } from './HttpJsonClient';

export class HttpNotificationTestGateway implements NotificationTestGateway {
  constructor(
    private readonly client: HttpJsonClient,
    private readonly subscriptions: PushSubscriptionProvider,
  ) {}

  async sendTestNotification(): Promise<void> {
    const current = await this.subscriptions.getCurrent();
    if (!current) throw new Error('No active browser push subscription.');
    await this.client.post('/notifications/test', { endpoint: current.endpoint });
  }
}
