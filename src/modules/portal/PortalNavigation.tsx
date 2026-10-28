import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { useAuth } from '../auth/AuthRoot';
import { privateRequest } from '../auth/client';
import { Icon, type IconName } from '../../shared/components/Icon';
import './portal.css';

export type PortalModule = 'schedule' | 'household' | 'injury';
export function currentPortalModule(path: string): PortalModule {
  return path.startsWith('/household') ? 'household' : path.startsWith('/injury') ? 'injury' : 'schedule';
}
const modules = [
  { id: 'schedule', label: '일정', href: '/', icon: 'calendar' },
  { id: 'household', label: '생활비·할 일', href: '/household', icon: 'home' },
  { id: 'injury', label: '산재', href: '/injury', icon: 'file' },
] as const;

// Shared only by the new module navigation. The accepted schedule nav is unchanged.
export function useNavigationPill(selected: string) {
  const bar = useRef<HTMLElement>(null), pill = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = bar.current, chip = pill.current;
    if (!node || !chip) return;
    const update = () => {
      const active = node.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active) { chip.style.opacity = '0'; return; }
      chip.style.width = active.offsetWidth + 'px';
      chip.style.transform = `translateX(${active.offsetLeft}px)`;
      chip.style.opacity = '1';
    };
    update();
    const resize = new ResizeObserver(update); resize.observe(node);
    return () => resize.disconnect();
  }, [selected]);
  return { bar, pill };
}

function handlePortalLink(event: MouseEvent<HTMLAnchorElement>, href: string, navigate: (href: string) => void) {
  // Preserve open-in-new-tab/window and ordinary link affordances.
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); navigate(href);
}
export function PortalHeader({ active, onNavigate }: { active: PortalModule; onNavigate(href: string): void }) {
  const auth = useAuth();
  const [injuryVisible, setInjuryVisible] = useState(true);
  const { bar, pill } = useNavigationPill(active + injuryVisible);
  useEffect(() => {
    if (!auth.enabled || !auth.user) return;
    const abort = new AbortController();
    const read = () => void privateRequest<{shortcutVisible:boolean}>('auth/preferences', 'GET', undefined, abort.signal).then(value => { if (!abort.signal.aborted) setInjuryVisible(value.shortcutVisible); }).catch(() => {});
    read(); window.addEventListener('cbh-shortcut-preference', read);
    return () => { abort.abort(); window.removeEventListener('cbh-shortcut-preference', read); };
  }, [auth.enabled, auth.user?.id]);
  if (!auth.enabled || !auth.user || auth.user.mustChangePassword) return null;
  return <nav ref={bar} className="portal-nav portal-top" style={{gridTemplateColumns: injuryVisible || active === 'injury' ? '1fr 1.45fr 1fr' : '1fr 1.45fr'}} aria-label="공간 선택">
    <span ref={pill} className="portal-pill" aria-hidden="true" />
    {modules.filter(item => item.id !== 'injury' || injuryVisible || active === 'injury').map(item => <a key={item.id} href={item.href} onClick={event => handlePortalLink(event,item.href,onNavigate)} aria-current={item.id === active ? 'page' : undefined}><Icon name={item.icon}/><span>{item.label}</span></a>)}
  </nav>;
}

const quickActions: Array<{ id: string; label: string; href: string; icon: IconName }> = [
  { id: 'expense', label: '쓴 돈 입력', href: '/household?section=ledger&action=add', icon: 'plus' },
  { id: 'note', label: '메모 남기기', href: '/household?section=notes&action=add', icon: 'edit' },
  { id: 'materials', label: '자료 올리기', href: '/injury?section=library', icon: 'upload' },
  { id: 'schedule', label: '근무표 가져오기', href: '/import', icon: 'calendar' },
];
export function FavoriteActions({ onNavigate, path }: { onNavigate(href: string): void; path: string }) {
  const { user, enabled } = useAuth();
  const [open, setOpen] = useState(false), [editing, setEditing] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(['expense', 'note', 'materials']);
  const holder = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null), held = useRef(false);
  const key = 'cbh.portal.favorites.' + user?.id;
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    setFavorites(['expense', 'note', 'materials']);
    try { const ids: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (Array.isArray(ids)) setFavorites(ids.filter(id => typeof id === 'string' && quickActions.some(a => a.id === id)));
    } catch { /* Use the short default list. */ }
    setOpen(false);
  }, [key]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!holder.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [open]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  if (!enabled || !user || user.mustChangePassword) return null;
  const stop = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  return <div ref={holder} className="portal-favorites">
    {open && <section id="portal-favorite-actions" className="portal-favorite-menu" aria-label="즐겨찾는 기능">
      <div className="portal-favorite-heading"><strong>자주 쓰는 기능</strong><button onClick={() => setEditing(!editing)}>{editing ? '완료' : '편집'}</button></div>
      {(editing ? quickActions : quickActions.filter(a => favorites.includes(a.id))).map(action => editing
        ? <label key={action.id}><input type="checkbox" checked={favorites.includes(action.id)} onChange={event => { const next = event.target.checked ? [...favorites, action.id] : favorites.filter(id => id !== action.id); setFavorites(next); try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Keep this session usable when device storage is unavailable. */ } }}/><Icon name={action.icon}/>{action.label}</label>
        : <a key={action.id} href={action.href} onClick={event => { handlePortalLink(event,action.href,onNavigate); if(event.defaultPrevented)setOpen(false); }}><Icon name={action.icon}/>{action.label}</a>)}
      {!editing && !favorites.length && <p>편집에서 자주 쓰는 기능을 골라 주세요.</p>}
    </section>}
    <button ref={trigger} className="portal-favorite-trigger" aria-label="즐겨찾는 기능 열기" aria-expanded={open} aria-controls="portal-favorite-actions"
      onPointerDown={() => { held.current = false; stop(); timer.current = setTimeout(() => { held.current = true; setOpen(true); }, 450); }}
      onPointerUp={stop} onPointerCancel={stop} onPointerLeave={stop}
      onContextMenu={event => { event.preventDefault(); setOpen(true); }}
      onClick={() => { if (!held.current) setOpen(!open); held.current = false; }}>
      <Icon name={open ? 'close' : 'plus'}/>
    </button>
  </div>;
}
