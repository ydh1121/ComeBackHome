import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { ApplicationServicesProvider } from './app/ApplicationServicesContext';
import { createApplicationServices } from './app/composition';
import { resolveRuntimeMode } from './config/runtime';
import { router } from './app/router';
import { registerPwaServiceWorker } from './pwa/registerServiceWorker';
import './shared/styles/base.css';

const root = document.getElementById('root');
if (!root) throw new Error('ComeBackHome root element was not found.');

async function start(): Promise<void> {
  const services = await createApplicationServices(resolveRuntimeMode());

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
