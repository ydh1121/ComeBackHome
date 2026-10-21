import { createPortal } from 'react-dom';
import { useLayoutEffect, useRef, type ReactNode, type PointerEvent } from 'react';


/** Native dialog provides focus trapping, Escape, inert background and focus
 * restoration. Only the grip/header starts a drag; the list keeps scrolling. */
export interface SheetClasses { portal: string; dialog: string; drag: string; handle: string; head: string; close: string; }
export interface DismissibleSheetProps { children: ReactNode; onClose(): void; label: string; closeLabel: string; closeIcon: ReactNode; classes: SheetClasses; }
export function DismissibleSheet({ children, onClose, label, closeLabel, closeIcon, classes }: DismissibleSheetProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const gesture = useRef<{ id: number; x: number; y: number; at: number; dy: number } | null>(null);
  useLayoutEffect(() => {
    const node = dialog.current!;
    const overflow = document.body.style.overflow;
    const active = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    node.showModal();
    return () => { node.close(); document.body.style.overflow = overflow; active?.focus({ preventScroll: true }); };
  }, []);
  const reset = () => {
    gesture.current = null;
    if (dialog.current) { dialog.current.style.transform = ''; dialog.current.removeAttribute('data-dragging'); }
  };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp, dy: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
    dialog.current?.setAttribute('data-dragging', 'true');
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    if (Math.abs(event.clientX - start.x) > Math.max(16, Math.abs(event.clientY - start.y) * 1.5)) { reset(); return; }
    start.dy = Math.max(0, event.clientY - start.y);
    if (dialog.current) dialog.current.style.transform = `translateY(${start.dy}px)`;
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    const velocity = start.dy / Math.max(1, event.timeStamp - start.at);
    const dismiss = start.dy >= 80 || (start.dy >= 32 && velocity > .6);
    reset();
    if (dismiss) close.current();
  };
  return createPortal(<div className={classes.portal}>
    <dialog ref={dialog} className={classes.dialog} aria-label={label}
      onCancel={event => { event.preventDefault(); close.current(); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close.current();
      }}>
      <div className={classes.drag} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={reset}>
        <div className={classes.handle} aria-hidden="true" />
        <div className={classes.head}><h2>{label}</h2><button type="button" className={classes.close} aria-label={closeLabel} onClick={onClose}>{closeIcon}</button></div>
      </div>
      {children}
    </dialog>
  </div>, document.body);
}
