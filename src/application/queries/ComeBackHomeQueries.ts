import type { EntityId, ISODate } from '../../domain/common';
import type { ImportBatch, NotificationSettings, Person, Place, PlaceKind, RouteCandidate, RoutePreference, ScheduleEntry, TransitAccessPoint } from '../../domain/models';
import type { TransitAccessFilter } from '../contracts/actions';
import type { RepositoryBundle } from '../contracts/runtime';
import { rankRouteCandidates, selectNextShift, selectVisibleAccessPoints } from '../selectors';
export interface PersonDetailQueryResult { person: Person | null; origin: Place | null; destination: Place | null; routePreference: RoutePreference | null; originAccessPoints: TransitAccessPoint[]; destinationAccessPoints: TransitAccessPoint[]; routeCandidates: RouteCandidate[]; }
export class ComeBackHomeQueries {
  constructor(private readonly repositories: RepositoryBundle) {}
  listPeople(): Promise<Person[]> { return this.repositories.people.list(); }
  listSchedule(personId: EntityId): Promise<ScheduleEntry[]> { return this.repositories.schedules.list(personId); }
  getImportReview(batchId: EntityId): Promise<ImportBatch | null> { return this.repositories.imports.getBatch(batchId); }
  getNotificationSettings(): Promise<NotificationSettings> { return this.repositories.notifications.getSettings(); }
  async getNextShift(personId: EntityId, after: ISODate): Promise<ScheduleEntry | null> { return selectNextShift(await this.repositories.schedules.list(personId), after); }
  async getTransitAccess(personId: EntityId, kind: PlaceKind, filter: TransitAccessFilter): Promise<TransitAccessPoint[]> { return selectVisibleAccessPoints(await this.repositories.commute.listAccessPoints(personId, kind), filter); }
  async getPersonDetail(personId: EntityId): Promise<PersonDetailQueryResult> {
    const [person, origin, destination, routePreference, originAccessPoints, destinationAccessPoints, routeCandidates] = await Promise.all([
      this.repositories.people.get(personId), this.repositories.places.get(personId, 'origin'), this.repositories.places.get(personId, 'destination'), this.repositories.commute.getRoutePreference(personId), this.repositories.commute.listAccessPoints(personId, 'origin'), this.repositories.commute.listAccessPoints(personId, 'destination'), this.repositories.commute.listRouteCandidates(personId),
    ]);
    return { person, origin, destination, routePreference, originAccessPoints, destinationAccessPoints, routeCandidates: rankRouteCandidates(routeCandidates) };
  }
}
