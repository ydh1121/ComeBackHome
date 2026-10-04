import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { ApplicationServicesProvider } from './app/ApplicationServicesContext';
import { createMockApplicationServices } from './app/composition';
import { router } from './app/router';
import './shared/styles/base.css';

const root = document.getElementById('root');
if (!root) throw new Error('ComeBackHome root element was not found.');

const services = createMockApplicationServices();

createRoot(root).render(
  <StrictMode>
    <ApplicationServicesProvider services={services}>
      <RouterProvider router={router} />
    </ApplicationServicesProvider>
  </StrictMode>,
);
