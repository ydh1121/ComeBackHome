import { Outlet, useLocation } from 'react-router';
import { useRouteScrollRestoration } from '../../app/useRouteScrollRestoration';
import { BottomNavigation } from './BottomNavigation';
import { TopUtility } from './TopUtility';
import './app-shell.css';

export function AppShell() {
  const location = useLocation();
  useRouteScrollRestoration();
  const showTopUtility = location.pathname === '/';

  return <div className="app-shell" data-ui="app-shell" data-version="highfi-v1.4.1"><div className="app-shell__app">{showTopUtility ? <TopUtility /> : null}<main className="app-shell__main"><Outlet /></main><BottomNavigation /></div></div>;
}
