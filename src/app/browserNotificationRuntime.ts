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
    subscriptionProvider: new BrowserPushSubscriptionProvider(config, async () => {
      const response = await client.get<{ configured: boolean; publicKey: string | null }>(
        '/notifications/client-key',
      );
      return response.configured ? response.publicKey : null;
    }),
    subscriptionTransport: new HttpPushSubscriptionTransport(client),
    configured: true, // The public key is supplied from canonical Pages runtime.
  };
}
