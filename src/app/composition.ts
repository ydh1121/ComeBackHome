import type { ApplicationServices, RepositoryBundle } from '../application/contracts/runtime';
import { ComeBackHomeQueries } from '../application/queries/ComeBackHomeQueries';
import { NotificationService, PersonSelectionService, PersonService, ScheduleService, TransitAccessService } from '../application/services/ApplicationActions';
import { ImportWorkflowService } from '../application/services/ImportWorkflowService';
import { CommitImportReview } from '../application/use-cases/commitImportReview';
import { MockImportFileSelectionAction } from '../mocks/import-actions';
import { MockNotificationPermissionProvider, MockNotificationTestGateway } from '../mocks/providers';
import { MockCommuteRepository, MockImportRepository, MockNotificationRepository, MockPersonRepository, MockPlaceRepository, MockScheduleRepository, MockTodayRepository } from '../mocks/repositories';
import { MOCK_FIXTURE, MockStateStore } from '../mocks/state';

export function createMockApplicationServices(): ApplicationServices {
  const store = new MockStateStore(structuredClone(MOCK_FIXTURE));
  const repositories: RepositoryBundle = {
    people: new MockPersonRepository(store),
    schedules: new MockScheduleRepository(store),
    places: new MockPlaceRepository(store),
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

  return {
    repositories,
    queries,
    actions: {
      commitImportReview: new CommitImportReview(repositories.imports, repositories.schedules),
      transitAccess: new TransitAccessService(repositories.commute, () => store.mutate(() => undefined)),
      notifications: new NotificationService(
        repositories.notifications,
        new MockNotificationPermissionProvider(),
        new MockNotificationTestGateway(),
      ),
      personSelection,
      people: new PersonService(repositories.people, personSelection),
      schedule: new ScheduleService(repositories.schedules, personSelection),
      importFiles: new MockImportFileSelectionAction(repositories.imports),
      importMatch: importWorkflow,
      importReview: importWorkflow,
    },
    changes: {
      subscribe: (listener) => store.subscribe(listener),
      getVersion: () => store.getVersion(),
    },
  };
}
