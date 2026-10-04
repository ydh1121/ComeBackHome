import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './app/router';
import './shared/styles/base.css';
const root = document.getElementById('root');
if (!root) throw new Error('ComeBackHome root element was not found.');
createRoot(root).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
