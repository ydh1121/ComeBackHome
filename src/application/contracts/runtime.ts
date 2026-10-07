import type { BusRouteActions, CommitImportReviewAction, CommuteActions, ImportFileSelectionAction, ImportMatchActions, ImportReviewActions, NotificationActions, PersonActions, PersonSelectionActions, PlaceActions, ScheduleActions, TransitAccessActions, TransitSearchActions } from './actions';
import type { CommuteRepository, ImportRepository, NotificationRepository, PersonRepository, PlaceRepository, PresenceRepository, ScheduleRepository, TodayRepository } from './repositories';
import type { ComeBackHomeQueries } from '../queries/ComeBackHomeQueries';
import type { PresenceAutomationGateway } from './providers';

export interface RepositoryBundle {
  people: PersonRepository;
  schedules: ScheduleRepository;
  places: PlaceRepository;
  presence: PresenceRepository;
  commute: CommuteRepository;
  imports: ImportRepository;
  notifications: NotificationRepository;
  today: TodayRepository;
}
export interface ChangeSignal {
  subscribe(listener: () => void): () => void;
  getVersion(): number;
}
export interface ApplicationRuntimeInfo {
  mode: 'mock' | 'hybrid-api';
  persistence: 'mock' | 'worker-api';
  providerData: 'mock' | 'worker-api' | 'disabled';
}

export interface ApplicationServices {
  runtime: ApplicationRuntimeInfo;
  repositories: RepositoryBundle;
  queries: ComeBackHomeQueries;
  actions: {
    commitImportReview: CommitImportReviewAction;
    transitAccess: TransitAccessActions;
    notifications: NotificationActions;
    personSelection: PersonSelectionActions;
    people: PersonActions;
    places: PlaceActions;
    commute: CommuteActions;
    transitSearch: TransitSearchActions;
    busRoutes: BusRouteActions;
    schedule: ScheduleActions;
    importFiles: ImportFileSelectionAction;
    importMatch: ImportMatchActions;
    importReview: ImportReviewActions;
    presenceAutomation: PresenceAutomationGateway;
  };
  changes: ChangeSignal;
}
