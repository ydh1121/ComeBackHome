import { createBrowserRouter, Navigate } from 'react-router';
import { productRoutes, qaRoutes } from '../application/route-manifest';
import { ImplementationBoundaryPage } from '../pages/ImplementationBoundaryPage';
import { ImportPage } from '../pages/ImportPage';
import { ImportPersonMatchPage } from '../pages/ImportPersonMatchPage';
import { ImportReviewPage } from '../pages/ImportReviewPage';
import { ImportStructurePage } from '../pages/ImportStructurePage';
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
  if (path === '/import') return ImportPage;
  if (path === '/import/:batchId/people') return ImportPersonMatchPage;
  if (path === '/import/:batchId/structure') return ImportStructurePage;
  if (path === '/import/:batchId/review') return ImportReviewPage;
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
