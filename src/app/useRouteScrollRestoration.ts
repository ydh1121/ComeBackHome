import { useLayoutEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router';

const scrollPositions = new Map<string, number>();

export function useRouteScrollRestoration(): void {
  const location = useLocation();
  const navigationType = useNavigationType();

  useLayoutEffect(() => {
    const key = location.key || `${location.pathname}${location.search}`;
    const target = navigationType === 'POP' ? scrollPositions.get(key) ?? 0 : 0;
    const frame = requestAnimationFrame(() => window.scrollTo({ top: target, left: 0, behavior: 'auto' }));

    return () => {
      cancelAnimationFrame(frame);
      scrollPositions.set(key, window.scrollY);
    };
  }, [location.key, location.pathname, location.search, navigationType]);
}
