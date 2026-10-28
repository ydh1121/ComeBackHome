let depth = 0;
let restore: (() => void) | undefined;

/** Private dialogs freeze the page on iOS as well as desktop. Restore only
 * the inline properties we own, including an existing scroll position. */
export function lockPrivatePageScroll(): () => void {
  if (depth++ === 0) {
    const body = document.body, html = document.documentElement;
    const x = window.scrollX, y = window.scrollY;
    const bodyKeys = ['position', 'top', 'left', 'width', 'overflow', 'padding-right'] as const;
    const htmlKeys = ['overflow', 'overscroll-behavior', 'scroll-behavior'] as const;
    const snapshot = (style: CSSStyleDeclaration, keys: readonly string[]) => keys.map(key => [key, style.getPropertyValue(key), style.getPropertyPriority(key)] as const);
    const bodyBefore = snapshot(body.style, bodyKeys), htmlBefore = snapshot(html.style, htmlKeys);
    const gutter = Math.max(0, window.innerWidth - html.clientWidth);
    if (gutter) body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + gutter}px`;
    Object.assign(body.style, { position: 'fixed', top: `${-y}px`, left: `${-x}px`, width: '100%', overflow: 'hidden' });
    Object.assign(html.style, { overflow: 'hidden', overscrollBehavior: 'none', scrollBehavior: 'auto' });
    restore = () => {
      for (const [key, value, priority] of bodyBefore) body.style.setProperty(key, value, priority);
      for (const [key, value, priority] of htmlBefore) if (key !== 'scroll-behavior') html.style.setProperty(key, value, priority);
      window.scrollTo({ left: x, top: y, behavior: 'instant' });
      const scrollBehavior = htmlBefore.find(([key]) => key === 'scroll-behavior')!;
      html.style.setProperty(...scrollBehavior);
    };
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--depth === 0) { restore?.(); restore = undefined; }
  };
}
