import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { ApplicationServicesProvider } from './app/ApplicationServicesContext';
import { createApplicationServices } from './app/composition';
import { resolveProviderRuntimeMode, resolveRuntimeMode } from './config/runtime';
import { router } from './app/router';
import { registerPwaServiceWorker } from './pwa/registerServiceWorker';
import './shared/styles/base.css';

const rootNode = document.getElementById('root');
if (!rootNode) throw new Error('ComeBackHome root element was not found.');
const root: HTMLElement = rootNode;

async function start(): Promise<void> {
  const runtimeMode = resolveRuntimeMode();
  const providerMode = resolveProviderRuntimeMode();
  const services = import.meta.env.DEV && runtimeMode === 'mock'
    ? (await import('./app/mockComposition')).createMockApplicationServices()
    : await createApplicationServices(runtimeMode, providerMode);

  createRoot(root).render(
    <StrictMode>
      <ApplicationServicesProvider services={services}>
        <RouterProvider router={router} />
      </ApplicationServicesProvider>
    </StrictMode>,
  );

  registerPwaServiceWorker();
}

void start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Application startup failed.';
  root.textContent = 'ComeBackHome 시작 실패: ' + message;
});
