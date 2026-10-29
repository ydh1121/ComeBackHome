import type { IconName } from '../../shared/components/Icon';

export const favoriteGroups = ['일정', '생활비·할 일', '산재', '설정'] as const;
export const favoriteActions: ReadonlyArray<{ id: string; label: string; href: string; icon: IconName; group: typeof favoriteGroups[number] }> = [
  { id: 'today', label: '오늘', href: '/', icon: 'home', group: '일정' },
  { id: 'schedule-list', label: '일정표', href: '/schedule', icon: 'calendar', group: '일정' },
  { id: 'schedule', label: '근무표 가져오기', href: '/import', icon: 'upload', group: '일정' },
  { id: 'schedule-history', label: '월별 이력', href: '/schedule/history', icon: 'calendar', group: '일정' },
  { id: 'people', label: '사람', href: '/people', icon: 'people', group: '일정' },
  { id: 'expense', label: '쓴 돈 입력', href: '/household?section=ledger&action=add', icon: 'plus', group: '생활비·할 일' },
  { id: 'cards', label: '카드', href: '/household?section=cards', icon: 'wallet', group: '생활비·할 일' },
  { id: 'ledger', label: '가계부', href: '/household?section=ledger', icon: 'edit', group: '생활비·할 일' },
  { id: 'income', label: '월급 나누기', href: '/household?section=income', icon: 'chart', group: '생활비·할 일' },
  { id: 'note', label: '메모 남기기', href: '/household?section=notes&action=add', icon: 'edit', group: '생활비·할 일' },
  { id: 'notes', label: '할 일·메모', href: '/household?section=notes', icon: 'check', group: '생활비·할 일' },
  { id: 'injury-today', label: '산재 오늘 할 일', href: '/injury?section=today', icon: 'check', group: '산재' },
  { id: 'injury-progress', label: '산재 진행 상황', href: '/injury?section=progress', icon: 'chart', group: '산재' },
  { id: 'materials', label: '자료 올리기', href: '/injury?section=library', icon: 'upload', group: '산재' },
  { id: 'injury-manage', label: '내 관리함', href: '/injury?section=manage', icon: 'file', group: '산재' },
  { id: 'notifications', label: '알림', href: '/notifications', icon: 'settings', group: '설정' },
  { id: 'account', label: '내 계정', href: '/account', icon: 'people', group: '설정' },
  { id: 'settings', label: '설정', href: '/settings', icon: 'settings', group: '설정' },
];

export interface FavoritePreferences { visible: boolean; ids: string[] }
export const favoritePreferenceEvent = 'cbh-favorite-preference';
export const defaultFavoritePreferences = (): FavoritePreferences => ({ visible: true, ids: ['expense', 'note', 'materials'] });
export const favoriteStorageKey = (accountId: string) => 'cbh.portal.favorites.' + accountId;

function validIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string')) return null;
  const ids = [...new Set(value.filter(id => favoriteActions.some(action => action.id === id)))];
  // An intentionally empty list stays empty. A corrupt or retired-only list
  // recovers to the short default list instead of leaving an unusable menu.
  return value.length && !ids.length ? null : ids;
}
export function parseFavoritePreferences(raw: string | null): FavoritePreferences {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    // Preserve the existing account-scoped array without an eager storage write.
    if (Array.isArray(value)) {
      const ids = validIds(value);
      return ids ? { visible: true, ids } : defaultFavoritePreferences();
    }
    if (value && typeof value === 'object' && 'version' in value && value.version === 1 && 'visible' in value && typeof value.visible === 'boolean' && 'ids' in value) {
      const ids = validIds(value.ids);
      if (ids) return { visible: value.visible, ids };
    }
  } catch { /* Corrupt device data must not prevent opening settings. */ }
  return defaultFavoritePreferences();
}
export function serializeFavoritePreferences(value: FavoritePreferences): string {
  return JSON.stringify({ version: 1, visible: value.visible, ids: validIds(value.ids) ?? defaultFavoritePreferences().ids });
}

export function portalHasPrivateShell(path: string): boolean {
  return path === '/account' || path === '/settings/favorites' || path === '/household' || path.startsWith('/household/') || path === '/injury' || path.startsWith('/injury/');
}
export function portalHasBottomNavigation(path: string): boolean {
  return path !== '/account' && path !== '/settings/favorites';
}
