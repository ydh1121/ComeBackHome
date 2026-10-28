import { useEffect, useState } from 'react';
import { Outlet } from 'react-router';
import { AccountPage, useAuth } from '../modules/auth/AuthRoot';
import { ApplicationServicesProvider } from './ApplicationServicesContext';
import { createApplicationServices } from './composition';
import { resolveProviderRuntimeMode, resolveRuntimeMode } from '../config/runtime';
import { releasePrivateImportImage } from '../application/services/WorkbookImportFileSelectionAction';

/** The accepted schedule services belong only to schedule routes. Other modules
 * can open independently, without fetching or initializing schedule data. */
export function ScheduleServices() {
  const auth = useAuth();
  const allowed = !auth.enabled || Boolean(auth.legacyAccess);
  const [services, setServices] = useState<Awaited<ReturnType<typeof createApplicationServices>> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    const runtimeMode = resolveRuntimeMode();
    const providerMode = resolveProviderRuntimeMode();
    const initialize = async () => import.meta.env.DEV && runtimeMode === 'mock'
      ? (await import('./mockComposition')).createMockApplicationServices()
      : createApplicationServices(runtimeMode, providerMode);
    void initialize().then(value => { if (active) setServices(value); }).catch(() => { if (active) setError('시작하지 못했습니다. 연결 상태를 확인한 뒤 새로고침해 주세요.'); });
    // A module switch now unmounts this layout without a document pagehide.
    // Retain the prior image-memory cleanup guarantee at that same boundary.
    return () => { active = false; releasePrivateImportImage(); };
  }, [allowed]);
  if (!allowed) return <AccountPage />;
  if (!services) return <p className="auth-loading" role="status">{error || 'ComeBackHome을 여는 중…'}</p>;
  return <ApplicationServicesProvider services={services}><Outlet /></ApplicationServicesProvider>;
}
