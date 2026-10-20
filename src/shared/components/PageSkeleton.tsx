import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';

const LoadingContext = createContext<(token: symbol, loading: boolean) => void>(() => undefined);

// In-flow placeholders use the page's own padding and row geometry. Nothing
// remains over the loaded content; quick/cache reads never show a skeleton.
export function PageSkeleton() {
  const report = useContext(LoadingContext);
  const { pathname } = useLocation();
  const [visible, setVisible] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setVisible(true), 180); return () => clearTimeout(timer); }, []);
  useLayoutEffect(() => {
    const token = Symbol('page-loading'); report(token, true);
    return () => report(token, false);
  }, [report]);
  const kind = pathname === '/schedule' ? 'roster' : pathname === '/schedule/history' ? 'calendar' : pathname === '/' ? 'today' : pathname === '/import' ? 'import' : 'list';
  return <div className={'page-loading-space skeleton-' + kind} data-loading="true">
    {visible ? <div className="page-skeleton" aria-hidden="true">
      {kind !== 'calendar' ? <i className="skeleton-heading" /> : null}
      {kind === 'roster' ? <><i className="skeleton-subheading" />{Array.from({length: 7}, (_, i) => <div className="skeleton-roster-row" key={i}><i /><i /></div>)}</> :
       kind === 'calendar' ? <div className="skeleton-calendar-grid">{Array.from({length: 35}, (_, i) => <i key={i} />)}</div> :
       kind === 'today' || kind === 'import' ? <i className="skeleton-hero" /> :
       <>{[0,1,2].map(i => <i className="skeleton-list-row" key={i} />)}</>}
    </div> : null}
  </div>;
}

export function LoadingReveal({ children }: { children: ReactNode }) {
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
      {loading ? <span className="sr-only" role="status">불러오는 중</span> : null}
    </div>
  </LoadingContext.Provider>;
}
