import type { ApplicationServices, RepositoryBundle } from '../application/contracts/runtime';
import { ComeBackHomeQueries } from '../application/queries/ComeBackHomeQueries';
import { NotificationService, TransitAccessService } from '../application/services/ApplicationActions';
import { CommitImportReview } from '../application/use-cases/commitImportReview';
import { MockNotificationPermissionProvider, MockNotificationTestGateway } from '../mocks/providers';
import { MockCommuteRepository, MockImportRepository, MockNotificationRepository, MockPersonRepository, MockPlaceRepository, MockScheduleRepository } from '../mocks/repositories';
import { MOCK_FIXTURE, MockStateStore } from '../mocks/state';
export function createMockApplicationServices(): ApplicationServices {
  const store = new MockStateStore(structuredClone(MOCK_FIXTURE));
  const repositories: RepositoryBundle = { people: new MockPersonRepository(store), schedules: new MockScheduleRepository(store), places: new MockPlaceRepository(store), commute: new MockCommuteRepository(store), imports: new MockImportRepository(store), notifications: new MockNotificationRepository(store) };
  const queries = new ComeBackHomeQueries(repositories);
  return { repositories, queries, actions: { commitImportReview: new CommitImportReview(repositories.imports, repositories.schedules), transitAccess: new TransitAccessService(repositories.commute, () => store.mutate(() => undefined)), notifications: new NotificationService(repositories.notifications, new MockNotificationPermissionProvider(), new MockNotificationTestGateway()) }, changes: { subscribe: (listener) => store.subscribe(listener), getVersion: () => store.getVersion() } };
}
