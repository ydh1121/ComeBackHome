import type { NotificationPermissionProvider, NotificationTestGateway, PushSubscriptionProvider } from '../application/contracts/providers';
import type { WebPushSubscriptionRecord } from '../domain/models';
export class MockNotificationPermissionProvider implements NotificationPermissionProvider { private permission: NotificationPermission = 'default'; async getPermission(): Promise<NotificationPermission> { return this.permission; } async requestPermissionFromUserGesture(): Promise<NotificationPermission> { this.permission = 'granted'; return this.permission; } }
export class MockNotificationTestGateway implements NotificationTestGateway { private sentCount = 0; async sendTestNotification(): Promise<void> { this.sentCount += 1; } getSentCount(): number { return this.sentCount; } }

export class MockPushSubscriptionProvider implements PushSubscriptionProvider {
  private subscription: WebPushSubscriptionRecord | null = null;

  async getCurrent(): Promise<WebPushSubscriptionRecord | null> {
    return this.subscription ? structuredClone(this.subscription) : null;
  }

  async subscribe(): Promise<WebPushSubscriptionRecord> {
    if (!this.subscription) {
      this.subscription = {
        endpoint: 'https://push.example.invalid/mock-subscription',
        expirationTime: null,
        keys: {
          p256dh: 'mock-p256dh',
          auth: 'mock-auth',
        },
      };
    }
    return structuredClone(this.subscription);
  }

  async unsubscribe(): Promise<void> {
    this.subscription = null;
  }
}
