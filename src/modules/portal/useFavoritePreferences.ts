import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { favoritePreferenceEvent, favoriteStorageKey, parseFavoritePreferences, serializeFavoritePreferences, type FavoritePreferences } from './favorites';

const sessionFallback = new Map<string, string>();
function readRaw(accountId: string | undefined): string | null {
  if (!accountId) return null;
  const key = favoriteStorageKey(accountId);
  if (sessionFallback.has(key)) return sessionFallback.get(key)!;
  try { return localStorage.getItem(key); } catch { return null; }
}
export function useFavoritePreferences(accountId: string | undefined) {
  const subscribe = useCallback((notify: () => void) => {
    if (!accountId) return () => {};
    const changed = (event: Event) => { if ((event as CustomEvent<string>).detail === accountId) notify(); };
    const stored = (event: StorageEvent) => {
      if (event.key === null || event.key === favoriteStorageKey(accountId)) {
        sessionFallback.delete(favoriteStorageKey(accountId)); notify();
      }
    };
    window.addEventListener(favoritePreferenceEvent, changed);
    window.addEventListener('storage', stored);
    return () => { window.removeEventListener(favoritePreferenceEvent, changed); window.removeEventListener('storage', stored); };
  }, [accountId]);
  const getSnapshot = useCallback(() => readRaw(accountId), [accountId]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const preferences = useMemo(() => parseFavoritePreferences(raw), [raw]);
  const update = useCallback((change: Partial<FavoritePreferences>): boolean => {
    if (!accountId) return false;
    const key = favoriteStorageKey(accountId);
    const next = serializeFavoritePreferences({ ...parseFavoritePreferences(readRaw(accountId)), ...change });
    let persisted = true;
    try { localStorage.setItem(key, next); sessionFallback.delete(key); }
    catch { sessionFallback.set(key, next); persisted = false; }
    window.dispatchEvent(new CustomEvent(favoritePreferenceEvent, { detail: accountId }));
    return persisted;
  }, [accountId]);
  return { preferences, update };
}
