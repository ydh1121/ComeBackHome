import { StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import {AuthRoot,AccountPage,useAuth} from './modules/auth/AuthRoot';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { ApplicationServicesProvider } from './app/ApplicationServicesContext';
import { createApplicationServices } from './app/composition';
import { resolveProviderRuntimeMode, resolveRuntimeMode } from './config/runtime';
import { router } from './app/router';
import { registerPwaServiceWorker } from './pwa/registerServiceWorker';
import './shared/styles/base.css';
import './shared/styles/private-module.css';

const rootNode = document.getElementById('root');
if (!rootNode) throw new Error('ComeBackHome root element was not found.');
const root: HTMLElement = rootNode;

const InjuryApp=lazy(()=>import('./modules/injury/ui/InjuryApp').then(m=>({default:m.InjuryApp})));
function ProductApplication(){
  const auth=useAuth();
  if(auth.enabled&&location.pathname.startsWith('/injury'))return <Suspense fallback={<p className="auth-loading">산재 자료를 여는 중…</p>}><InjuryApp/></Suspense>;
  if(auth.enabled&&(location.pathname==='/account'||!auth.legacyAccess))return <AccountPage/>;
  return <LegacyApplication/>;
}
function LegacyApplication(){
  const [services,setServices]=useState<Awaited<ReturnType<typeof createApplicationServices>>|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{let active=true;
    const runtimeMode = resolveRuntimeMode();
    const providerMode = resolveProviderRuntimeMode();
    const initialize=async()=>import.meta.env.DEV && runtimeMode === 'mock'
      ? (await import('./app/mockComposition')).createMockApplicationServices()
      : createApplicationServices(runtimeMode,providerMode);
    void initialize().then(value=>{if(active)setServices(value);}).catch(()=>{if(active)setError('시작하지 못했습니다. 연결 상태를 확인한 뒤 새로고침해 주세요.');});
    return()=>{active=false;};
  },[]);
  if(!services)return <p className="auth-loading" role="status">{error||'ComeBackHome을 여는 중…'}</p>;
  return <ApplicationServicesProvider services={services}><RouterProvider router={router}/></ApplicationServicesProvider>;
}
createRoot(root).render(<StrictMode><AuthRoot mock={import.meta.env.DEV&&resolveRuntimeMode()==='mock'}><ProductApplication/></AuthRoot></StrictMode>);
registerPwaServiceWorker();
