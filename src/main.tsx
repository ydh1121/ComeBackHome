import { StrictMode, useEffect, useSyncExternalStore } from 'react';
import {AuthRoot,useAuth} from './modules/auth/AuthRoot';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { PortalHeader, FavoriteActions, currentPortalModule } from './modules/portal/PortalNavigation';
import { portalHasPrivateShell } from './modules/portal/favorites';
import { resolveRuntimeMode } from './config/runtime';
import { router } from './app/router';
import { registerPwaServiceWorker } from './pwa/registerServiceWorker';
import './shared/styles/base.css';
import './shared/styles/private-module.css';

const rootNode = document.getElementById('root');
if (!rootNode) throw new Error('ComeBackHome root element was not found.');
const root: HTMLElement = rootNode;

const subscribeRoute = (notify: () => void) => router.subscribe(() => notify());
const currentPath = () => router.state.location.pathname;
const navigatePortal = (href: string) => { void router.navigate(href); };
function ProductApplication(){
  const auth=useAuth();
  const path=useSyncExternalStore(subscribeRoute,currentPath,currentPath);
  const showPortal = auth.enabled && !!auth.user && !auth.user.mustChangePassword;
  useEffect(()=>{if(portalHasPrivateShell(path))window.scrollTo({top:0,left:0,behavior:'auto'});},[path]);
  return <><PortalHeader path={path} active={currentPortalModule(path)} onNavigate={navigatePortal}/><div className={showPortal ? 'portal-content' : undefined}><RouterProvider router={router}/></div><FavoriteActions onNavigate={navigatePortal} path={path}/></>;
}
createRoot(root).render(<StrictMode><AuthRoot mock={import.meta.env.DEV&&resolveRuntimeMode()==='mock'}><ProductApplication/></AuthRoot></StrictMode>);
registerPwaServiceWorker();
