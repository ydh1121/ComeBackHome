export interface CacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ReadCacheOptions {
  dataKey: string;
  settingKey: string;
  isCacheableRead(path: string): boolean;
  storage?: () => CacheStorage | undefined;
  events?: EventTarget;
  defaultEnabled?: () => boolean;
  now?: () => number;
  ttlMs?: number;
  maxEntries?: number;
  maxSerializedChars?: number;
}

/** A per-instance, explicitly allowlisted cache. It never falls back to expired
 * data and never shares mutable result objects or state between consumers. */
export function createReadCache(options: ReadCacheOptions) {
  const ttl = options.ttlMs ?? 60_000;
  const limit = options.maxEntries ?? 32;
  const maxChars = options.maxSerializedChars ?? 500_000;
  if (!options.dataKey || !options.settingKey || options.dataKey === options.settingKey ||
      !Number.isFinite(ttl) || ttl <= 0 || !Number.isInteger(limit) || limit < 1 ||
      !Number.isInteger(maxChars) || maxChars < 1) throw new Error('Invalid read cache configuration.');
  const now = options.now ?? (() => new Date().getTime());
  type Entry = { expires: number; value: unknown };
  let entries: Record<string, Entry> = {};
  let generation = 0;
  let disposed = false;
  const inFlight = new Map<string, Promise<unknown>>();
  const storage = () => { try { return options.storage?.(); } catch { return undefined; } };
  function enabled(): boolean {
    try {
      const value = storage()?.getItem(options.settingKey);
      return value === 'true' || (value !== 'false' && (options.defaultEnabled?.() ?? false));
    } catch { return false; }
  }
  function persist() {
    try {
      const data = JSON.stringify(entries);
      if (data.length <= maxChars) storage()?.setItem(options.dataKey, data);
    } catch { /* Optional persistence; memory remains usable. */ }
  }
  function restore() {
    try {
      const raw = JSON.parse(storage()?.getItem(options.dataKey) ?? '{}') as Record<string, Entry>;
      entries = Object.fromEntries(Object.entries(raw).filter(([, item]) => item &&
        Number.isFinite(item.expires) && item.expires > now() && item.expires <= now() + ttl));
    } catch { entries = {}; }
  }
  function invalidate() {
    generation++;
    entries = {};
    inFlight.clear();
    try { storage()?.removeItem(options.dataKey); } catch { /* Optional persistence. */ }
  }
  const onStorage = (event: Event) => {
    if ([options.dataKey, options.settingKey].includes((event as StorageEvent).key ?? '')) {
      generation++; inFlight.clear(); restore();
    }
  };
  restore();
  options.events?.addEventListener('storage', onStorage);
  return {
    enabled,
    invalidate,
    setEnabled(value: boolean) { storage()?.setItem(options.settingKey, String(value)); invalidate(); },
    size() { return Object.keys(entries).length ? new Blob([JSON.stringify(entries)]).size : 0; },
    async read<T>(key: string, path: string, read: () => Promise<T>): Promise<T> {
      if (disposed || !options.isCacheableRead(path) || !enabled()) return read();
      const cached = entries[key];
      if (cached?.expires > now()) return structuredClone(cached.value) as T;
      const pending = inFlight.get(key);
      if (pending) return structuredClone(await pending) as T;
      const started = generation;
      const request = read().then(value => {
        if (!disposed && started === generation && enabled()) {
          const fresh = Object.entries(entries).filter(([, entry]) => entry.expires > now());
          entries = Object.fromEntries(limit === 1 ? [] : fresh.slice(-(limit - 1)));
          entries[key] = { value: structuredClone(value), expires: now() + ttl };
          persist();
        }
        return value;
      }).finally(() => { if (inFlight.get(key) === request) inFlight.delete(key); });
      inFlight.set(key, request);
      return structuredClone(await request);
    },
    dispose() {
      disposed = true; generation++; entries = {}; inFlight.clear();
      options.events?.removeEventListener('storage', onStorage);
    },
  };
}
