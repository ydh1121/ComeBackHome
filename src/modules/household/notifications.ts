import { useEffect, useRef, useState } from 'react';
import { BrowserPushSubscriptionProvider } from '../../providers/browser/BrowserPushSubscriptionProvider';
import { categorizePushError, PUSH_FAILURE_MESSAGES } from '../../features/notifications/pushErrors';
import { privateRequest } from '../auth/client';

function optedIn(userId: string) { try { return localStorage.getItem('cbh.household.push.' + userId) === 'true'; } catch { return false; } }
function rememberOptIn(userId: string, value: boolean) { try { localStorage.setItem('cbh.household.push.' + userId, String(value)); } catch { /* Permission and server state remain authoritative. */ } }

const provider = () => new BrowserPushSubscriptionProvider({ applicationServerKey: null }, async () => {
  const result = await privateRequest<{ configured: boolean; publicKey: string | null }>('notifications/client-key');
  return result.configured ? result.publicKey : null;
});
export function useHouseholdPush(userId: string | undefined) {
  const [registered, setRegistered] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const current = useRef(userId); current.current = userId;
  useEffect(() => {
    let live = true; setRegistered(false); setError('');
    if (!userId || !('Notification' in window) || Notification.permission !== 'granted') return;
    void (async () => {
      try {
        const subscription = await provider().getCurrent();
        if (!subscription || !live || current.current !== userId) return;
        const status = await privateRequest<{ registered: boolean }>('private/household/push-subscription', 'POST', { endpoint: subscription.endpoint });
        if (!live || current.current !== userId) return;
        if (!status.registered && optedIn(userId)) {
          await privateRequest('private/household/push-subscription', 'PUT', subscription);
          if (live && current.current === userId) setRegistered(true);
        } else setRegistered(status.registered);
      } catch { /* Push readiness never blocks the ledger. */ }
    })();
    return () => { live = false; };
  }, [userId]);
  const connect = async () => {
    if (busy || !userId) return;
    setBusy(true); setError('');
    try {
      if (!('Notification' in window) || !('serviceWorker' in navigator)) throw new Error('Push is not supported.');
      // Invoke permission before the first await so iPhone retains the tap gesture.
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission !== 'granted') throw new Error(PUSH_FAILURE_MESSAGES.NO_PERMISSION);
      const runtime = provider();
      if (!(await runtime.isCompatible())) throw new Error('VAPID key mismatch.');
      const subscription = await runtime.subscribe();
      if (current.current !== userId) return;
      await privateRequest('private/household/push-subscription', 'PUT', subscription);
      if (current.current === userId) { setRegistered(true); rememberOptIn(userId, true); }
    } catch (err) { if (current.current === userId) setError(err instanceof Error && err.message === PUSH_FAILURE_MESSAGES.NO_PERMISSION ? err.message : PUSH_FAILURE_MESSAGES[categorizePushError(err)]); }
    finally { if (current.current === userId) setBusy(false); }
  };
  const disconnect = async () => {
    if (busy || !userId) return;
    setBusy(true); setError('');
    try {
      const subscription = await provider().getCurrent();
      if (subscription) await privateRequest('private/household/push-subscription', 'DELETE', { endpoint: subscription.endpoint });
      if (current.current === userId) { setRegistered(false); rememberOptIn(userId, false); }
      // The same browser subscription still serves the unchanged schedule module.
    } catch { setError('알림 연결을 끄지 못했어요. 다시 시도해 주세요.'); }
    finally { if (current.current === userId) setBusy(false); }
  };
  return { registered, busy, error, connect, disconnect };
}
