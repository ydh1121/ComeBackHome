import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import { LoadingBoundary, useLoadingPlaceholder } from '../../../packages/portable/react/loading';

// In-flow placeholders use the page's own padding and row geometry. Nothing
// remains over the loaded content; quick/cache reads never show a skeleton.
export function PageSkeleton() {
  const { pathname } = useLocation();
  const visible = useLoadingPlaceholder();
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
  return <LoadingBoundary label="불러오는 중">{children}</LoadingBoundary>;
}
