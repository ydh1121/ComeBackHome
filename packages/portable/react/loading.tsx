import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
const LoadingContext = createContext<(token: symbol, loading: boolean) => void>(() => undefined);
export function useLoadingPlaceholder(delayMs = 180) {
  const report = useContext(LoadingContext);
  const [visible, setVisible] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setVisible(true), delayMs); return () => clearTimeout(timer); }, [delayMs]);
  useLayoutEffect(() => {
    const token = Symbol('page-loading'); report(token, true);
    return () => report(token, false);
  }, [report]);
  return visible;
}

export function LoadingBoundary({ children, label }: { children: ReactNode; label: string }) {
  const [tokens, setTokens] = useState<Set<symbol>>(new Set());
  const report = useMemo(() => (token: symbol, loading: boolean) => setTokens(previous => {
    const next = new Set(previous);
    if (loading) next.add(token); else next.delete(token);
    return next;
  }), []);
  const loading = tokens.size > 0;
  return <LoadingContext.Provider value={report}>
    <div className="page-reveal" aria-busy={loading}>
      <div className="t-skel-content" inert={loading}>{children}</div>
      {loading ? <span className="sr-only" role="status">{label}</span> : null}
    </div>
  </LoadingContext.Provider>;
}
