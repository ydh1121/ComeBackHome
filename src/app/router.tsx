import { createBrowserRouter, Navigate } from 'react-router';
import { productRoutes } from '../application/route-manifest';
import { ImplementationBoundaryPage } from '../pages/ImplementationBoundaryPage';
import { ImportPage } from '../pages/ImportPage';
import { ImportPersonMatchPage } from '../pages/ImportPersonMatchPage';
import { ImportReviewPage } from '../pages/ImportReviewPage';
import { ImportStructurePage } from '../pages/ImportStructurePage';
import { PeoplePage } from '../pages/PeoplePage';
import { PersonCreatePage } from '../pages/PersonCreatePage';
import { PersonDetailPage } from '../pages/PersonDetailPage';
import { PersonEditPage } from '../pages/PersonEditPage';
import { OriginPlaceEditPage, DestinationPlaceEditPage } from '../pages/PlaceEditPage';
import { CommuteRoutePage } from '../pages/CommuteRoutePage';
import { CommuteManualPage } from '../pages/CommuteManualPage';
import { TransitAccessPage } from '../pages/TransitAccessPage';
import { TransitSearchPage } from '../pages/TransitSearchPage';
import { BusRoutePage } from '../pages/BusRoutePage';
import { NotificationPage } from '../pages/NotificationPage';
import { SettingsPage } from '../pages/SettingsPage';
import { PresenceAutomationPage } from '../pages/PresenceAutomationPage';
import { ScheduleBulkEditPage } from '../pages/ScheduleBulkEditPage';
import { ScheduleDayEditPage } from '../pages/ScheduleDayEditPage';
import { SchedulePage } from '../pages/SchedulePage';
import { TodayPage } from '../pages/TodayPage';
import { AppShell } from '../shared/layout/AppShell';

function componentFor(path: string) {
  if (path === '/') return TodayPage;
  if (path === '/schedule') return SchedulePage;
  if (path === '/schedule/edit') return ScheduleBulkEditPage;
  if (path === '/schedule/new') return ScheduleDayEditPage;
  if (path === '/schedule/:date/edit') return ScheduleDayEditPage;
  if (path === '/import') return ImportPage;
  if (path === '/import/:batchId/people') return ImportPersonMatchPage;
  if (path === '/import/:batchId/structure') return ImportStructurePage;
  if (path === '/import/:batchId/review') return ImportReviewPage;
  if (path === '/people') return PeoplePage;
  if (path === '/people/new') return PersonCreatePage;
  if (path === '/people/:personId/edit') return PersonEditPage;
  if (path === '/people/:personId') return PersonDetailPage;
  if (path === '/people/:personId/place/origin') return OriginPlaceEditPage;
  if (path === '/people/:personId/place/destination') return DestinationPlaceEditPage;
  if (path === '/people/:personId/commute') return CommuteRoutePage;
  if (path === '/people/:personId/commute/manual') return CommuteManualPage;
  if (path === '/people/:personId/commute/routes/:routeId') return CommuteManualPage;
  if (path === '/people/:personId/commute/:placeKind/access') return TransitAccessPage;
  if (path === '/people/:personId/commute/:placeKind/access/search') return TransitSearchPage;
  if (path === '/people/:personId/commute/:placeKind/access/:accessId/bus-routes') return BusRoutePage;
  if (path === '/notifications') return NotificationPage;
  if (path === '/settings') return SettingsPage;
  if (path === '/settings/presence') return PresenceAutomationPage;
  return ImplementationBoundaryPage;
}

const productRouteEntries = productRoutes.map((path) => ({ path, Component: componentFor(path) }));
const qaRouteEntries = import.meta.env.DEV
  ? [
      {
        path: '/__qa/states',
        lazy: async () => ({
          Component: (await import('../pages/QaStateMatrixPage')).QaStateMatrixPage,
        }),
      },
      {
        path: '/__qa/flow',
        lazy: async () => ({
          Component: (await import('../pages/QaFlowMapPage')).QaFlowMapPage,
        }),
      },
      {
        path: '/__qa/desktop-drop',
        lazy: async () => ({
          Component: (await import('../pages/QaDesktopDropPage')).QaDesktopDropPage,
        }),
      },
    ]
  : [];

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
