import type { NotificationPermissionProvider } from '../../application/contracts/providers';

export class BrowserNotificationPermissionProvider implements NotificationPermissionProvider {
  getPermissionSnapshot(): NotificationPermission {
    if (!globalThis.isSecureContext || typeof Notification === 'undefined') return 'default';
    return Notification.permission;
  }

  async getPermission(): Promise<NotificationPermission> {
    return this.getPermissionSnapshot();
  }

  async requestPermissionFromUserGesture(): Promise<NotificationPermission> {
    if (!globalThis.isSecureContext) throw new Error('Secure context is required.');
    if (typeof Notification === 'undefined') throw new Error('Notification API is not supported.');
    return Notification.requestPermission();
  }
}
