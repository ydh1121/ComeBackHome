import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router';
import { releasePrivateImportImage } from '../../application/services/WorkbookImportFileSelectionAction';
import { useRouteScrollRestoration } from '../../app/useRouteScrollRestoration';
import { BottomNavigation } from './BottomNavigation';
import { TopUtility } from './TopUtility';
import { LoadingReveal } from '../components/PageSkeleton';
import '../styles/transitions.css';
import './app-shell.css';

function RouteReveal({ children }: { children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = wrap.current;
    const frame = requestAnimationFrame(() => { if (node) { void node.offsetWidth; node.dataset.page = '2'; } });
    return () => cancelAnimationFrame(frame);
  }, []);
  return <div className="t-page-slide route-reveal" ref={wrap} data-page="0"><div className="t-page" data-page-id="2"><LoadingReveal>{children}</LoadingReveal></div></div>;
}

export function AppShell() {
  const location = useLocation();
  // iOS exposes standalone on home-screen apps (including desktop-UA iPads).
  // Ordinary Safari/desktop/Android retain the already accepted layout.
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  useEffect(() => {
    if (!/^\/import(?:\/|$)/.test(location.pathname)) releasePrivateImportImage();
  }, [location.pathname]);
  useRouteScrollRestoration();
  const showTopUtility = location.pathname === '/';

  return <div className="app-shell" data-ui="app-shell" data-version="daily-life-v1" data-ios-standalone={iosStandalone}>{iosStandalone ? <div className="app-shell__status-background" aria-hidden="true" /> : null}<div className="app-shell__app">{showTopUtility ? <TopUtility /> : null}<main className="app-shell__main"><RouteReveal key={location.pathname}><Outlet /></RouteReveal></main><BottomNavigation /></div></div>;
}
