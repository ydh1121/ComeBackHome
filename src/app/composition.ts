import type { ApplicationServices, RepositoryBundle } from '../application/contracts/runtime';
import type {
  PlaceSearchProvider,
  RealtimeBusProvider,
  RealtimeSubwayProvider,
  TransitAccessSearchProvider,
} from '../application/contracts/providers';
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
import type { AppRuntimeMode, ProviderRuntimeMode } from '../config/runtime';
import {
  HttpBusRouteLookupProvider,
  HttpPlaceSearchProvider,
  HttpRealtimeBusProvider,
  HttpRealtimeSubwayProvider,
  HttpTransitAccessSearchProvider,
  HttpTransitRouteProvider,
} from '../providers/http/HttpDataProviders';
import { HttpJsonClient } from '../providers/http/HttpJsonClient';
import { HttpNotificationTestGateway } from '../providers/http/HttpNotificationTestGateway';
import { HttpPresenceAutomationGateway } from '../providers/http/HttpPresenceAutomationGateway';
import { HttpPresenceRepository } from '../providers/http/HttpPresenceRepository';
import {
  HttpCommuteRepository,
  HttpNotificationRepository,
  HttpPersonRepository,
  HttpPlaceRepository,
  HttpScheduleRepository,
} from '../providers/http/HttpRepositories';
import { ReadExcelWorkbookParser } from '../providers/import/ReadExcelWorkbookParser';
import { Weekly3ColumnScheduleImageRecognizer } from '../providers/import/Weekly3ColumnScheduleImageRecognizer';
import { PaddleWeeklyRegionalTextExtractor } from '../providers/import/PaddleWeeklyRegionalTextExtractor';
import { BrowserScheduleTableStructureDetector } from '../providers/import/ScheduleTableStructureDetector';
import {
  BrowserScheduleOcrPreprocessor,
  TesseractJsWorkerFactory,
  TesseractScheduleImageTextExtractor,
} from '../providers/import/TesseractScheduleImageTextExtractor';
import { SAME_ORIGIN_TESSERACT_ASSETS } from '../providers/import/ocrRuntimeConfig';
import { BrowserImportRepository } from '../providers/browser/BrowserImportRepository';
import { ProviderCommuteRepository, ProviderTodayRepository } from '../providers/runtime/ProviderRuntimeRepositories';
import { createBrowserNotificationRuntime } from './browserNotificationRuntime';
import { createChangeSignalController } from './changeSignal';

const SELECTED_PERSON_STORAGE_KEY = 'cbh:selected-person-id';

const disabledPlaceSearchProvider: PlaceSearchProvider = {
  async search() { return []; },
};

const disabledTransitAccessSearchProvider: TransitAccessSearchProvider = {
  async search() { return []; },
  async nearby() { return []; },
  async resolve(result) { return result; },
};

const disabledRealtimeBusProvider: RealtimeBusProvider = {
  async arrivals() { return []; },
};

const disabledRealtimeSubwayProvider: RealtimeSubwayProvider = {
  async arrivals() { return []; },
};

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

export async function createHybridApiApplicationServices(
  providerMode: ProviderRuntimeMode = 'api',
): Promise<ApplicationServices> {
  const changes = createChangeSignalController();

  const client = new HttpJsonClient('/api', () => changes.emit());
  const browserNotifications = createBrowserNotificationRuntime(client);
  const people = new HttpPersonRepository(client);
  const schedules = new HttpScheduleRepository(client);
  const places = new HttpPlaceRepository(client);
  const presence = new HttpPresenceRepository(client);
  const persistedCommute = new HttpCommuteRepository(client);

  const routeProvider = providerMode === 'api' ? new HttpTransitRouteProvider(client) : null;
  const busRouteLookupProvider = providerMode === 'api' ? new HttpBusRouteLookupProvider(client) : null;
  const realtimeBusProvider = providerMode === 'api' ? new HttpRealtimeBusProvider(client) : disabledRealtimeBusProvider;
  const realtimeSubwayProvider = providerMode === 'api' ? new HttpRealtimeSubwayProvider(client) : disabledRealtimeSubwayProvider;

  const commute = providerMode === 'api' && routeProvider
    ? new ProviderCommuteRepository(persistedCommute, places, routeProvider)
    : persistedCommute;

  const imports = new BrowserImportRepository(() => changes.emit());
  const notifications = new HttpNotificationRepository(client, () => changes.emit());
  const today = new ProviderTodayRepository(
    schedules,
    commute,
    presence,
    realtimeBusProvider,
    realtimeSubwayProvider,
  );

  const repositories: RepositoryBundle = {
    people,
    schedules,
    places,
    presence,
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
  const placeSearchProvider = providerMode === 'api'
    ? new HttpPlaceSearchProvider(client)
    : disabledPlaceSearchProvider;
  const transitSearchProvider = providerMode === 'api'
    ? new HttpTransitAccessSearchProvider(client)
    : disabledTransitAccessSearchProvider;
  const imageTextExtractor = new TesseractScheduleImageTextExtractor(
    new TesseractJsWorkerFactory(SAME_ORIGIN_TESSERACT_ASSETS),
    new BrowserScheduleOcrPreprocessor(),
    { useStructureFirstMode: true },
  );
  // Actual image-upload composition: only current-workplace WEEKLY_7D_3COL.
  // Unsupported image geometry fails closed into an actionable import error;
  // XLSX remains handled independently by ReadExcelWorkbookParser.
  const imageRecognizer = new Weekly3ColumnScheduleImageRecognizer(
    new BrowserScheduleTableStructureDetector(),
    imageTextExtractor,
    new PaddleWeeklyRegionalTextExtractor(),
    async () => (await people.list()).map((person) => person.name),
  );
  const importFileSelection = new WorkbookImportFileSelectionAction(
    imports,
    people,
    schedules,
    new ReadExcelWorkbookParser(),
    imageRecognizer,
  );

  return {
    runtime: {
      mode: 'hybrid-api',
      persistence: 'worker-api',
      providerData: providerMode === 'api' ? 'worker-api' : 'disabled',
    },
    repositories,
    queries,
    actions: {
      commitImportReview: new CommitImportReview(imports, schedules),
      transitAccess: new TransitAccessService(commute, () => changes.emit()),
      notifications: new NotificationService(
        notifications,
        browserNotifications.permissionProvider,
        browserNotifications.subscriptionProvider,
        new HttpNotificationTestGateway(client, browserNotifications.subscriptionProvider),
        browserNotifications.subscriptionTransport,
      ),
      personSelection,
      people: new PersonService(people, personSelection),
      places: new PlaceService(places, placeSearchProvider),
      commute: new CommuteService(commute),
      transitSearch: new TransitSearchService(places, commute, transitSearchProvider),
      busRoutes: new BusRouteService(commute, places, routeProvider, busRouteLookupProvider),
      schedule: new ScheduleService(schedules, personSelection),
      importFiles: importFileSelection,
      importMatch: importWorkflow,
      importReview: importWorkflow,
      presenceAutomation: new HttpPresenceAutomationGateway(),
    },
    changes,
  };
}

export async function createApplicationServices(
  mode: AppRuntimeMode,
  providerMode: ProviderRuntimeMode = 'api',
): Promise<ApplicationServices> {
  if (providerMode === 'api' && mode !== 'api') {
    throw new Error('Provider API runtime requires VITE_CBH_RUNTIME=api.');
  }
  if (mode !== 'api') {
    throw new Error('Mock runtime is development-only.');
  }
  return createHybridApiApplicationServices(providerMode);
}
