// Only short-lived, same-origin read models. Never cache credentials, Push
// subscriptions, images, provider responses or writes. Expired data is not used
// as an offline fallback: an old schedule must not look freshly confirmed.
const DATA_KEY = 'cbh.read-cache.v1';
const SETTING_KEY = 'cbh.cache-enabled.v1';
const TTL = 60_000;
type Entry = { expires: number; value: unknown };
let entries: Record<string, Entry> = {};
let generation = 0;
const inFlight = new Map<string, Promise<unknown>>();
function storage(): Storage | undefined { try { return globalThis.localStorage; } catch { return undefined; } }
export function localCacheEnabled(): boolean {
  try {
    const value = storage()?.getItem(SETTING_KEY);
    return value === 'true' || (value !== 'false' && typeof window !== 'undefined');
  } catch { return false; }
}
function persist() {
  try {
    const data = JSON.stringify(entries);
    if (data.length <= 500_000) storage()?.setItem(DATA_KEY, data);
  } catch { /* Storage limits/private browsing fall back to memory. */ }
}
function restore() {
  try {
    const raw = JSON.parse(storage()?.getItem(DATA_KEY) ?? '{}') as Record<string, Entry>;
    entries = Object.fromEntries(Object.entries(raw).filter(([, item]) => item && Number.isFinite(item.expires) && item.expires > new Date().getTime() && item.expires <= new Date().getTime() + TTL));
  } catch { entries = {}; }
}
restore();
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if ([DATA_KEY, SETTING_KEY].includes(event.key ?? '')) { generation++; inFlight.clear(); restore(); }
  });
}
export function invalidateLocalReads() {
  generation++;
  entries = {};
  inFlight.clear();
  try { storage()?.removeItem(DATA_KEY); } catch { /* optional cache */ }
}
export function isCacheableRead(path: string): boolean {
  return /^\/people(?:\/[^/?]+(?:\/schedules(?:\/latest-import|\/\d{4}-\d{2}-\d{2})?|\/places\/(?:origin|destination)|\/commute\?kind=(?:origin|destination))?)?$/.test(path);
}
export async function cachedRead<T>(key: string, path: string, read: () => Promise<T>): Promise<T> {
  if (!isCacheableRead(path) || !localCacheEnabled()) return read();
  const cached = entries[key];
  if (cached?.expires > new Date().getTime()) return structuredClone(cached.value) as T;
  const pending = inFlight.get(key);
  if (pending) return structuredClone(await pending) as T;
  const started = generation;
  const request = read().then(value => {
    if (started === generation && localCacheEnabled()) {
      entries = Object.fromEntries(Object.entries(entries).filter(([, entry]) => entry.expires > new Date().getTime()).slice(-31));
      entries[key] = { value: structuredClone(value), expires: new Date().getTime() + TTL };
      persist();
    }
    return value;
  }).finally(() => { if (inFlight.get(key) === request) inFlight.delete(key); });
  inFlight.set(key, request);
  return structuredClone(await request);
}
export async function syncShellCache(clear = false): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const worker = registration?.active;
  if (!worker) return;
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('캐시 설정 응답이 없습니다. 다시 시도해 주세요.')); }, 4000);
    channel.port1.onmessage = event => {
      clearTimeout(timer); channel.port1.close();
      if (event.data?.ok) resolve(); else reject(new Error('캐시 설정을 저장하지 못했습니다.'));
    };
    worker.postMessage({ type: 'CBH_CACHE', enabled: localCacheEnabled(), clear }, [channel.port2]);
  });
}
export async function setLocalCacheEnabled(enabled: boolean) {
  storage()?.setItem(SETTING_KEY, String(enabled));
  invalidateLocalReads();
  await syncShellCache(!enabled);
}
export async function clearLocalCache() {
  invalidateLocalReads();
  await syncShellCache(true);
}
export function localCacheSize(): number { return Object.keys(entries).length ? new Blob([JSON.stringify(entries)]).size : 0; }
