import type {
  NotificationPermissionProvider,
  PushSubscriptionProvider,
  PushSubscriptionTransport,
} from '../application/contracts/providers';
import { createWebPushClientConfig } from '../config/webPush';
import { BrowserNotificationPermissionProvider } from '../providers/browser/BrowserNotificationPermissionProvider';
import { BrowserPushSubscriptionProvider } from '../providers/browser/BrowserPushSubscriptionProvider';
import { HttpJsonClient } from '../providers/http/HttpJsonClient';
import { HttpPushSubscriptionTransport } from '../providers/http/HttpRepositories';

export interface BrowserNotificationRuntime {
  permissionProvider: NotificationPermissionProvider;
  subscriptionProvider: PushSubscriptionProvider;
  subscriptionTransport: PushSubscriptionTransport;
  configured: boolean;
}

export function createBrowserNotificationRuntime(
  client: HttpJsonClient,
  applicationServerKey = import.meta.env.VITE_CBH_VAPID_PUBLIC_KEY,
): BrowserNotificationRuntime {
  const config = createWebPushClientConfig(applicationServerKey);

  return {
    permissionProvider: new BrowserNotificationPermissionProvider(),
    subscriptionProvider: new BrowserPushSubscriptionProvider(config),
    subscriptionTransport: new HttpPushSubscriptionTransport(client),
    configured: config.applicationServerKey != null,
  };
}
