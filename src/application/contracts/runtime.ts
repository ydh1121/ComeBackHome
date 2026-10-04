import type { BusRouteActions, CommuteActions, ImportFileSelectionAction, ImportMatchActions, ImportReviewActions, NotificationActions, PersonActions, PersonSelectionActions, PlaceActions, ScheduleActions, TransitAccessActions, TransitSearchActions } from './actions';
import type { CommuteRepository, ImportRepository, NotificationRepository, PersonRepository, PlaceRepository, ScheduleRepository, TodayRepository } from './repositories';
import type { CommitImportReview } from '../use-cases/commitImportReview';
import type { ComeBackHomeQueries } from '../queries/ComeBackHomeQueries';

export interface RepositoryBundle {
  people: PersonRepository;
  schedules: ScheduleRepository;
  places: PlaceRepository;
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
  providerData: 'mock';
}

export interface ApplicationServices {
  runtime: ApplicationRuntimeInfo;
  repositories: RepositoryBundle;
  queries: ComeBackHomeQueries;
  actions: {
    commitImportReview: CommitImportReview;
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
  };
  changes: ChangeSignal;
}
