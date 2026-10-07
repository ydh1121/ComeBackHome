import type { ApplicationServices, RepositoryBundle } from '../application/contracts/runtime';
import { ComeBackHomeQueries } from '../application/queries/ComeBackHomeQueries';
import {
  NotificationService,
  PersonSelectionService,
  PersonService,
  ScheduleService,
  TransitAccessService,
} from '../application/services/ApplicationActions';
import { ImportWorkflowService } from '../application/services/ImportWorkflowService';
import { WorkbookImportFileSelectionAction } from '../application/services/WorkbookImportFileSelectionAction';
import {
  BusRouteService,
  CommuteService,
  PlaceService,
  TransitSearchService,
} from '../application/services/CommuteWorkflowService';
import { CommitImportReview } from '../application/use-cases/commitImportReview';
import { MockPlaceSearchProvider, MockTransitAccessSearchProvider } from '../mocks/commute-providers';
import {
  MockNotificationPermissionProvider,
  MockNotificationTestGateway,
  MockPresenceAutomationGateway,
  MockPushSubscriptionProvider,
} from '../mocks/providers';
import {
  MockCommuteRepository,
  MockImportRepository,
  MockNotificationRepository,
  MockPersonRepository,
  MockPlaceRepository,
  MockPresenceRepository,
  MockScheduleRepository,
  MockTodayRepository,
} from '../mocks/repositories';
import { MOCK_FIXTURE, MockStateStore } from '../mocks/state';
import { ReadExcelWorkbookParser } from '../providers/import/ReadExcelWorkbookParser';

export function createMockApplicationServices(): ApplicationServices {
  const store = new MockStateStore(structuredClone(MOCK_FIXTURE));
  const repositories: RepositoryBundle = {
    people: new MockPersonRepository(store),
    schedules: new MockScheduleRepository(store),
    places: new MockPlaceRepository(store),
    presence: new MockPresenceRepository(),
    commute: new MockCommuteRepository(store),
    imports: new MockImportRepository(store),
    notifications: new MockNotificationRepository(store),
    today: new MockTodayRepository(store),
  };
  const personSelection = new PersonSelectionService(
    store.read().selectedPersonId ?? store.read().people[0]?.id ?? null,
    () => store.mutate(() => undefined),
  );
  const queries = new ComeBackHomeQueries(repositories, personSelection);
  const importWorkflow = new ImportWorkflowService(repositories.imports, repositories.people);
  const placeSearchProvider = new MockPlaceSearchProvider();
  const transitSearchProvider = new MockTransitAccessSearchProvider();
  const importFileSelection = new WorkbookImportFileSelectionAction(
    repositories.imports,
    repositories.people,
    repositories.schedules,
    new ReadExcelWorkbookParser(),
  );

  return {
    runtime: {
      mode: 'mock',
      persistence: 'mock',
      providerData: 'mock',
    },
    repositories,
    queries,
    actions: {
      commitImportReview: new CommitImportReview(repositories.imports, repositories.schedules),
      transitAccess: new TransitAccessService(repositories.commute, () => store.mutate(() => undefined)),
      notifications: new NotificationService(
        repositories.notifications,
        new MockNotificationPermissionProvider(),
        new MockPushSubscriptionProvider(),
        new MockNotificationTestGateway(),
      ),
      personSelection,
      people: new PersonService(repositories.people, personSelection),
      places: new PlaceService(repositories.places, placeSearchProvider),
      commute: new CommuteService(repositories.commute),
      transitSearch: new TransitSearchService(repositories.places, repositories.commute, transitSearchProvider),
      busRoutes: new BusRouteService(repositories.commute, repositories.places, null),
      schedule: new ScheduleService(repositories.schedules, personSelection),
      importFiles: importFileSelection,
      importMatch: importWorkflow,
      importReview: importWorkflow,
      presenceAutomation: new MockPresenceAutomationGateway(),
    },
    changes: {
      subscribe: (listener) => store.subscribe(listener),
      getVersion: () => store.getVersion(),
    },
  };
}
