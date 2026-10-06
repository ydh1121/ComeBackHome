import type { EntityId, ISODate } from '../../domain/common';
import type { EtaSnapshot, ImportBatch, NotificationSettings, Person, Place, PlaceKind, RouteCandidate, RoutePreference, SavedCommuteRoute, ScheduleEntry, TransitAccessPoint } from '../../domain/models';
import type { PersonSelectionActions, TransitAccessFilter } from '../contracts/actions';
import type { RepositoryBundle } from '../contracts/runtime';
import { rankRouteCandidates, selectNextShift, selectVisibleAccessPoints } from '../selectors';

export interface PersonDetailQueryResult { person: Person | null; origin: Place | null; destination: Place | null; routePreference: RoutePreference | null; savedRoutes: SavedCommuteRoute[]; originAccessPoints: TransitAccessPoint[]; destinationAccessPoints: TransitAccessPoint[]; routeCandidates: RouteCandidate[]; }
export interface TodayOverviewQueryResult { people: Person[]; person: Person | null; eta: EtaSnapshot | null; shiftEnd: string | null; nextShiftLabel: string | null; route: RouteCandidate | null; }
export interface CommuteOverviewQueryResult extends PersonDetailQueryResult { preferredRouteCandidateId: EntityId | null; }

function formatNextShiftLabel(referenceDate: ISODate, shift: ScheduleEntry | null): string | null {
  if (!shift) return null;
  const from = Date.parse(`${referenceDate}T00:00:00Z`);
  const to = Date.parse(`${shift.date}T00:00:00Z`);
  const diff = Math.round((to - from) / 86_400_000);
  if (diff === 0) return `오늘 ${shift.start}`;
  if (diff === 1) return `내일 ${shift.start}`;
  const [, month, day] = shift.date.split('-');
  return `${Number(month)}/${Number(day)} ${shift.start}`;
}

export class ComeBackHomeQueries {
  constructor(private readonly repositories: RepositoryBundle, private readonly selection: PersonSelectionActions) {}
  listPeople(): Promise<Person[]> { return this.repositories.people.list(); }
  getPerson(personId: EntityId): Promise<Person | null> { return this.repositories.people.get(personId); }
  getPlace(personId: EntityId, kind: PlaceKind): Promise<Place | null> { return this.repositories.places.get(personId, kind); }
  listSchedule(personId: EntityId): Promise<ScheduleEntry[]> { return this.repositories.schedules.list(personId); }
  getCurrentImportBatch(): Promise<ImportBatch | null> { return this.repositories.imports.getCurrentBatch(); }
  getImportReview(batchId: EntityId): Promise<ImportBatch | null> { return this.repositories.imports.getBatch(batchId); }
  getNotificationSettings(): Promise<NotificationSettings> { return this.repositories.notifications.getSettings(); }
  async getNextShift(personId: EntityId, after: ISODate): Promise<ScheduleEntry | null> { return selectNextShift(await this.repositories.schedules.list(personId), after); }
  async getTransitAccess(personId: EntityId, kind: PlaceKind, filter: TransitAccessFilter): Promise<TransitAccessPoint[]> { return selectVisibleAccessPoints(await this.repositories.commute.listAccessPoints(personId, kind), filter); }

  async getTodayOverview(referenceDate: ISODate): Promise<TodayOverviewQueryResult> {
    const people = await this.repositories.people.list();
    const selectedId = this.selection.getSelectedPersonId() ?? people[0]?.id ?? null;
    if (!selectedId) return { people, person: null, eta: null, shiftEnd: null, nextShiftLabel: null, route: null };

    const [person, today, schedule, routes] = await Promise.all([
      this.repositories.people.get(selectedId),
      this.repositories.today.get(selectedId),
      this.repositories.schedules.list(selectedId),
      this.repositories.commute.listRouteCandidates(selectedId),
    ]);

    const nextShift = selectNextShift(
      schedule.filter((entry) => entry.date > referenceDate),
      referenceDate,
    );
    const route = today?.routeCandidateId
      ? routes.find((candidate) => candidate.id === today.routeCandidateId) ?? null
      : rankRouteCandidates(routes)[0] ?? null;

    return {
      people,
      person,
      eta: today?.eta ?? null,
      shiftEnd: today?.shiftEnd ?? null,
      nextShiftLabel: formatNextShiftLabel(referenceDate, nextShift),
      route,
    };
  }

  async getCommuteOverview(personId: EntityId): Promise<CommuteOverviewQueryResult> {
    const detail = await this.getPersonDetail(personId);
    const preferredRouteCandidateId = await this.repositories.commute.getPreferredRouteCandidateId(personId);
    const preferred = detail.routeCandidates.find((candidate) => candidate.id === preferredRouteCandidateId);
    const routeCandidates = preferred
      ? [preferred, ...detail.routeCandidates.filter((candidate) => candidate.id !== preferred.id)]
      : detail.routeCandidates;
    return { ...detail, routeCandidates, preferredRouteCandidateId };
  }

  async getAccessPoint(personId: EntityId, kind: PlaceKind, accessPointId: EntityId): Promise<TransitAccessPoint | null> {
    const points = await this.repositories.commute.listAccessPoints(personId, kind);
    return points.find((point) => point.id === accessPointId) ?? null;
  }

  async getPersonDetail(personId: EntityId): Promise<PersonDetailQueryResult> {
    const [person, origin, destination, routePreference, savedRoutes, originAccessPoints, destinationAccessPoints, routeCandidates, preferredRouteCandidateId] = await Promise.all([
      this.repositories.people.get(personId),
      this.repositories.places.get(personId, 'origin'),
      this.repositories.places.get(personId, 'destination'),
      this.repositories.commute.getRoutePreference(personId),
      this.repositories.commute.listSavedRoutes(personId),
      this.repositories.commute.listAccessPoints(personId, 'origin'),
      this.repositories.commute.listAccessPoints(personId, 'destination'),
      this.repositories.commute.listRouteCandidates(personId),
      this.repositories.commute.getPreferredRouteCandidateId(personId),
    ]);
    const ranked = rankRouteCandidates(routeCandidates);
    const preferred = ranked.find((candidate) => candidate.id === preferredRouteCandidateId);
    const ordered = preferred ? [preferred, ...ranked.filter((candidate) => candidate.id !== preferred.id)] : ranked;
    return { person, origin, destination, routePreference, savedRoutes, originAccessPoints, destinationAccessPoints, routeCandidates: ordered };
  }
}
