import { createPortal } from 'react-dom';
import { useEffect, useId, useLayoutEffect, useRef, type PointerEvent, type ReactNode } from 'react';
import { Icon } from '../../shared/components/Icon';
import { useAuth } from '../auth/AuthRoot';
import { lockPrivatePageScroll } from './private-scroll-lock';
import './private-sheet.css';

interface PrivateSheetProps {
  title: string;
  children: ReactNode;
  onClose(): void;
  busy?: boolean;
  className?: string;
  scopeClassName?: string;
  closeLabel?: string;
  onSessionChange?(): void;
}

/** Private-module modal. The accepted schedule sheet remains independent. */
export function PrivateSheet({ title, children, onClose, busy = false, className = '', scopeClassName = '', closeLabel = '닫기', onSessionChange }: PrivateSheetProps) {
  const id = useId(), dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const auth = useAuth(), owner = useRef(auth.user?.id), invalidated = useRef(false);
  if (owner.current !== auth.user?.id) invalidated.current = true;
  const available = !auth.checking && !invalidated.current && (!auth.enabled || (!!auth.user && !auth.user.mustChangePassword));
  const availableNow = useRef(available);
  availableNow.current = available;
  const dismiss = useRef(() => {});
  dismiss.current = () => { if (!busy) onClose(); };
  const gesture = useRef<{ id: number; x: number; y: number; at: number; dy: number } | null>(null);
  const sessionDismiss = useRef(onSessionChange ?? onClose);
  sessionDismiss.current = onSessionChange ?? onClose;
  useEffect(() => { if (invalidated.current) sessionDismiss.current(); }, [auth.user?.id]);
  useLayoutEffect(() => {
    if (!available) return;
    const node = dialog.current!;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unlock = lockPrivatePageScroll();
    const viewport = window.visualViewport;
    const fitViewport = () => {
      const height = viewport?.height ?? window.innerHeight, top = viewport?.offsetTop ?? 0;
      node.style.setProperty('--private-sheet-viewport-height', `${height}px`);
      node.style.setProperty('--private-sheet-viewport-top', `${top}px`);
      node.style.setProperty('--private-sheet-viewport-bottom', `${Math.max(0, window.innerHeight - height - top)}px`);
    };
    fitViewport();
    viewport?.addEventListener('resize', fitViewport);
    viewport?.addEventListener('scroll', fitViewport);
    window.addEventListener('resize', fitViewport);
    // Native dialog initial-focus steps must choose this non-input element,
    // before showModal can focus a text field and open the iOS keyboard.
    heading.current?.setAttribute('autofocus', '');
    node.showModal();
    // Reading the title does not summon the keyboard or highlight Close.
    heading.current?.focus({ preventScroll: true });
    return () => {
      viewport?.removeEventListener('resize', fitViewport);
      viewport?.removeEventListener('scroll', fitViewport);
      window.removeEventListener('resize', fitViewport);
      node.close();
      unlock();
      if (availableNow.current && active?.isConnected) active.focus({ preventScroll: true });
    };
  }, [available]);
  const reset = () => {
    gesture.current = null;
    if (dialog.current) { dialog.current.style.transform = ''; dialog.current.removeAttribute('data-dragging'); }
  };
  const down = (event: PointerEvent<HTMLElement>) => {
    if (busy || !event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp, dy: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
    dialog.current?.setAttribute('data-dragging', 'true');
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    if (Math.abs(event.clientX - start.x) > Math.max(16, Math.abs(event.clientY - start.y) * 1.5)) { reset(); return; }
    start.dy = Math.max(0, event.clientY - start.y);
    if (dialog.current) dialog.current.style.transform = `translateY(${start.dy}px)`;
  };
  const up = (event: PointerEvent<HTMLElement>) => {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    const shouldDismiss = start.dy >= 80 || (start.dy >= 32 && start.dy / Math.max(1, event.timeStamp - start.at) > .6);
    reset();
    if (shouldDismiss) dismiss.current();
  };
  if (invalidated.current) return null;
  return createPortal(<div className={`private-sheet-portal ${scopeClassName}`} hidden={!available}>
    <dialog ref={dialog} className={`private-sheet ${className}`} aria-labelledby={id} aria-modal="true" aria-busy={busy || undefined}
      onCancel={event => { event.preventDefault(); dismiss.current(); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dismiss.current();
      }}>
      <header className="private-sheet__header" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={reset}>
        <span className="private-sheet__handle" aria-hidden="true" />
        <div className="private-sheet__heading">
          <h2 id={id} ref={heading} tabIndex={-1}>{title}</h2>
          <button type="button" className="private-sheet__close" aria-label={closeLabel} disabled={busy} onClick={() => dismiss.current()}><Icon name="close" /></button>
        </div>
      </header>
      <div className="private-sheet__body">{children}</div>
    </dialog>
  </div>, document.body);
}
