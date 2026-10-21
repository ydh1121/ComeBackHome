import { useSyncExternalStore } from 'react';
export type ThemePreference = 'system' | 'light' | 'dark';
/** Bind React to installTheme's event names; no storage or global listeners at import time. */
export function createThemePreferenceBinding(events: { changeEvent: string; preferenceEvent: string }) {
  const subscribe = (notify: () => void) => {
    window.addEventListener(events.changeEvent, notify);
    return () => window.removeEventListener(events.changeEvent, notify);
  };
  const snapshot = (): ThemePreference => {
    const value = document.documentElement.dataset.themePreference;
    return value === 'light' || value === 'dark' ? value : 'system';
  };
  return {
    useThemePreference() { return useSyncExternalStore(subscribe, snapshot, () => 'system' as const); },
    setThemePreference(value: ThemePreference) {
      window.dispatchEvent(new CustomEvent(events.preferenceEvent, { detail: value }));
    },
  };
}
