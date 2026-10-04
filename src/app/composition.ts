import type { ApplicationServices, RepositoryBundle } from '../application/contracts/runtime';
import { ComeBackHomeQueries } from '../application/queries/ComeBackHomeQueries';
import { NotificationService, PersonSelectionService, PersonService, ScheduleService, TransitAccessService } from '../application/services/ApplicationActions';
import { ImportWorkflowService } from '../application/services/ImportWorkflowService';
import { BusRouteService, CommuteService, PlaceService, TransitSearchService } from '../application/services/CommuteWorkflowService';
import { CommitImportReview } from '../application/use-cases/commitImportReview';
import type { AppRuntimeMode } from '../config/runtime';
import { MockImportFileSelectionAction } from '../mocks/import-actions';
import { MockPlaceSearchProvider, MockTransitAccessSearchProvider } from '../mocks/commute-providers';
import { MockNotificationPermissionProvider, MockNotificationTestGateway, MockPushSubscriptionProvider } from '../mocks/providers';
import { MockCommuteRepository, MockImportRepository, MockNotificationRepository, MockPersonRepository, MockPlaceRepository, MockScheduleRepository, MockTodayRepository } from '../mocks/repositories';
import { MOCK_FIXTURE, MockStateStore } from '../mocks/state';
import { HttpJsonClient } from '../providers/http/HttpJsonClient';
import {
  HttpCommuteRepository,
  HttpNotificationRepository,
  HttpPersonRepository,
  HttpPlaceRepository,
  HttpScheduleRepository,
  HybridCommuteRepository,
} from '../providers/http/HttpRepositories';
import { createChangeSignalController } from './changeSignal';

const SELECTED_PERSON_STORAGE_KEY = 'cbh:selected-person-id';

function readStoredPersonId(): string | null {
  try {
    return localStorage.getItem(SELECTED_PERSON_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredPersonId(personId: string): void {
  try {
    localStorage.setItem(SELECTED_PERSON_STORAGE_KEY, personId);
  } catch {
    // Selection persistence is best-effort only.
  }
}

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
  const placeSearchProvider = new MockPlaceSearchProvider();
  const transitSearchProvider = new MockTransitAccessSearchProvider();

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
      busRoutes: new BusRouteService(repositories.commute),
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

export async function createHybridApiApplicationServices(): Promise<ApplicationServices> {
  const runtimeStore = new MockStateStore(structuredClone(MOCK_FIXTURE));
  const changes = createChangeSignalController();
  runtimeStore.subscribe(() => changes.emit());

  const client = new HttpJsonClient('/api', () => changes.emit());
  const people = new HttpPersonRepository(client);
  const schedules = new HttpScheduleRepository(client);
  const places = new HttpPlaceRepository(client);
  const persistedCommute = new HttpCommuteRepository(client);
  const runtimeCommute = new MockCommuteRepository(runtimeStore);
  const commute = new HybridCommuteRepository(persistedCommute, runtimeCommute);
  const imports = new MockImportRepository(runtimeStore);
  const notifications = new HttpNotificationRepository(client, () => changes.emit());
  const today = new MockTodayRepository(runtimeStore);

  const repositories: RepositoryBundle = {
    people,
    schedules,
    places,
    commute,
    imports,
    notifications,
    today,
  };

  const availablePeople = await people.list();
  const storedPersonId = readStoredPersonId();
  const initialPersonId = storedPersonId && availablePeople.some((person) => person.id === storedPersonId)
    ? storedPersonId
    : availablePeople[0]?.id ?? null;

  let personSelection!: PersonSelectionService;
  personSelection = new PersonSelectionService(initialPersonId, () => {
    const selected = personSelection.getSelectedPersonId();
    if (selected) writeStoredPersonId(selected);
    changes.emit();
  });

  const queries = new ComeBackHomeQueries(repositories, personSelection);
  const importWorkflow = new ImportWorkflowService(imports, people);
  const placeSearchProvider = new MockPlaceSearchProvider();
  const transitSearchProvider = new MockTransitAccessSearchProvider();

  return {
    runtime: {
      mode: 'hybrid-api',
      persistence: 'worker-api',
      providerData: 'mock',
    },
    repositories,
    queries,
    actions: {
      commitImportReview: new CommitImportReview(imports, schedules),
      transitAccess: new TransitAccessService(commute, () => changes.emit()),
      notifications: new NotificationService(
        notifications,
        new MockNotificationPermissionProvider(),
        new MockPushSubscriptionProvider(),
        new MockNotificationTestGateway(),
      ),
      personSelection,
      people: new PersonService(people, personSelection),
      places: new PlaceService(places, placeSearchProvider),
      commute: new CommuteService(commute),
      transitSearch: new TransitSearchService(places, commute, transitSearchProvider),
      busRoutes: new BusRouteService(commute),
      schedule: new ScheduleService(schedules, personSelection),
      importFiles: new MockImportFileSelectionAction(imports),
      importMatch: importWorkflow,
      importReview: importWorkflow,
    },
    changes,
  };
}

export async function createApplicationServices(mode: AppRuntimeMode): Promise<ApplicationServices> {
  return mode === 'api' ? createHybridApiApplicationServices() : createMockApplicationServices();
}
