import type { NotificationActions, PersonSelectionActions, ScheduleActions, TransitAccessActions } from './actions';
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
export interface ApplicationServices {
  repositories: RepositoryBundle;
  queries: ComeBackHomeQueries;
  actions: {
    commitImportReview: CommitImportReview;
    transitAccess: TransitAccessActions;
    notifications: NotificationActions;
    personSelection: PersonSelectionActions;
    schedule: ScheduleActions;
  };
  changes: ChangeSignal;
}
