import { createBrowserRouter, Navigate } from 'react-router';
import { productRoutes, qaRoutes } from '../application/route-manifest';
import { ImplementationBoundaryPage } from '../pages/ImplementationBoundaryPage';

const productRouteEntries = productRoutes.map((path) => ({
  path,
  Component: ImplementationBoundaryPage,
}));

const qaRouteEntries = import.meta.env.DEV
  ? qaRoutes.map((path) => ({ path, Component: ImplementationBoundaryPage }))
  : [];

export const router = createBrowserRouter([
  ...productRouteEntries,
  ...qaRouteEntries,
  { path: '*', element: <Navigate to="/" replace /> },
]);
