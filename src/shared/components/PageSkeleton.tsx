import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';

const LoadingContext = createContext<(token: symbol, loading: boolean) => void>(() => undefined);

export function PageSkeleton() {
  const report = useContext(LoadingContext);
  useLayoutEffect(() => {
    const token = Symbol('page-loading');
    report(token, true);
    return () => report(token, false);
  }, [report]);
  return <div className="page-loading-space" data-loading="true" />;
}

// One overlay survives the loading -> content swap. It never keeps a second
// route mounted, so forms, OCR and requests retain their existing lifecycle.
export function LoadingReveal({ children }: { children: ReactNode }) {
  const [tokens, setTokens] = useState<Set<symbol>>(new Set());
  const report = useMemo(() => (token: symbol, loading: boolean) => setTokens(previous => {
    const next = new Set(previous);
    if (loading) next.add(token); else next.delete(token);
    return next;
  }), []);
  const loading = tokens.size > 0;
  return <LoadingContext.Provider value={report}>
    <div className={'t-skel page-reveal'+(loading ? ' is-resetting' : ' is-revealed')} aria-busy={loading}>
      <div className={'t-skel-skeleton page-skeleton'+(loading ? ' is-pulsing' : '')} aria-hidden="true"><i className="skeleton-heading" /><i className="skeleton-hero" /><i /><i /><i /></div>
      <div className="t-skel-content" inert={loading}>{children}</div>
      {loading ? <span className="sr-only" role="status">불러오는 중</span> : null}
    </div>
  </LoadingContext.Provider>;
}
