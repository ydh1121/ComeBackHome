import type { NotificationPermissionProvider } from '../../application/contracts/providers';

export class BrowserNotificationPermissionProvider implements NotificationPermissionProvider {
  async getPermission(): Promise<NotificationPermission> {
    if (!globalThis.isSecureContext || typeof Notification === 'undefined') return 'default';
    return Notification.permission;
  }

  async requestPermissionFromUserGesture(): Promise<NotificationPermission> {
    if (!globalThis.isSecureContext) throw new Error('Secure context is required.');
    if (typeof Notification === 'undefined') throw new Error('Notification API is not supported.');
    return Notification.requestPermission();
  }
}
