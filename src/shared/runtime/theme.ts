import { useSyncExternalStore } from 'react';
export type ThemePreference = 'system' | 'light' | 'dark';
const subscribe = (notify: () => void) => {
  window.addEventListener('cbh:theme-change', notify);
  return () => window.removeEventListener('cbh:theme-change', notify);
};
const snapshot = (): ThemePreference => {
  const value = document.documentElement.dataset.themePreference;
  return value === 'light' || value === 'dark' ? value : 'system';
};
export function useThemePreference() {
  return useSyncExternalStore(subscribe, snapshot, () => 'system' as const);
}
export function setThemePreference(value: ThemePreference) {
  window.dispatchEvent(new CustomEvent('cbh:theme-preference', { detail: value }));
}
