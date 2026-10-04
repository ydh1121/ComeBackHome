import type { NotificationActions, TransitAccessActions } from './actions';
import type { CommuteRepository, ImportRepository, NotificationRepository, PersonRepository, PlaceRepository, ScheduleRepository } from './repositories';
import type { CommitImportReview } from '../use-cases/commitImportReview';
import type { ComeBackHomeQueries } from '../queries/ComeBackHomeQueries';
export interface RepositoryBundle { people: PersonRepository; schedules: ScheduleRepository; places: PlaceRepository; commute: CommuteRepository; imports: ImportRepository; notifications: NotificationRepository; }
export interface ChangeSignal { subscribe(listener: () => void): () => void; getVersion(): number; }
export interface ApplicationServices { repositories: RepositoryBundle; queries: ComeBackHomeQueries; actions: { commitImportReview: CommitImportReview; transitAccess: TransitAccessActions; notifications: NotificationActions; }; changes: ChangeSignal; }
