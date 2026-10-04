import { createBrowserRouter, Navigate } from 'react-router';
import { productRoutes, qaRoutes } from '../application/route-manifest';
import { ImplementationBoundaryPage } from '../pages/ImplementationBoundaryPage';
import { ScheduleBulkEditPage } from '../pages/ScheduleBulkEditPage';
import { ScheduleDayEditPage } from '../pages/ScheduleDayEditPage';
import { SchedulePage } from '../pages/SchedulePage';
import { TodayPage } from '../pages/TodayPage';
import { AppShell } from '../shared/layout/AppShell';

function componentFor(path: string) {
  if (path === '/') return TodayPage;
  if (path === '/schedule') return SchedulePage;
  if (path === '/schedule/edit') return ScheduleBulkEditPage;
  if (path === '/schedule/:date/edit') return ScheduleDayEditPage;
  return ImplementationBoundaryPage;
}

const productRouteEntries = productRoutes.map((path) => ({ path, Component: componentFor(path) }));
const qaRouteEntries = import.meta.env.DEV ? qaRoutes.map((path) => ({ path, Component: ImplementationBoundaryPage })) : [];

export const router = createBrowserRouter([
  {
    Component: AppShell,
    children: [
      ...productRouteEntries,
      ...qaRouteEntries,
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
