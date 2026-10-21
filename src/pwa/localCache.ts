import { createReadCache } from '../../packages/portable/browser/read-cache';
import { requestWorkerAcknowledgement } from '../../packages/portable/browser/worker-message';

// Product policy: only 60-second same-origin read models. Never credentials,
// subscriptions, images, live providers, writes, or expired offline schedules.
export function isCacheableRead(path: string): boolean {
  return /^\/people(?:\/[^/?]+(?:\/schedules(?:\/latest-import|\/\d{4}-\d{2}-\d{2})?|\/places\/(?:origin|destination)|\/commute\?kind=(?:origin|destination))?)?$/.test(path);
}

const cache = createReadCache({
  dataKey: 'cbh.read-cache.v1', settingKey: 'cbh.cache-enabled.v1', ttlMs: 60_000,
  isCacheableRead, storage: () => globalThis.localStorage,
  events: typeof window === 'undefined' ? undefined : window,
  defaultEnabled: () => typeof window !== 'undefined',
});
export const localCacheEnabled = cache.enabled;
export const invalidateLocalReads = cache.invalidate;
export const cachedRead = cache.read;
export const localCacheSize = cache.size;

export async function syncShellCache(clear = false): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const worker = registration?.active;
  if (!worker) return;
  await requestWorkerAcknowledgement(worker, { type: 'CBH_CACHE', enabled: localCacheEnabled(), clear }, {
    timeoutMessage: '캐시 설정 응답이 없습니다. 다시 시도해 주세요.',
    failureMessage: '캐시 설정을 저장하지 못했습니다.',
  });
}
export async function setLocalCacheEnabled(enabled: boolean) {
  cache.setEnabled(enabled);
  await syncShellCache(!enabled);
}
export async function clearLocalCache() {
  cache.invalidate();
  await syncShellCache(true);
}
