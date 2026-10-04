import type { ImportBatch, ImportFileRecord, ImportResolution, NotificationRules, NotificationSettings, Person, Place, PlaceKind, RouteCandidate, RoutePreference, ScheduleEntry, TodaySnapshot, TransitAccessPoint } from '../../domain/models';
import type { EntityId, ISODate } from '../../domain/common';
export interface PersonRepository { list(): Promise<Person[]>; get(id: EntityId): Promise<Person | null>; create(input: Omit<Person,'id'>): Promise<Person>; update(id: EntityId, patch: Partial<Omit<Person,'id'>>): Promise<Person>; }
export interface ScheduleRepository { list(personId: EntityId): Promise<ScheduleEntry[]>; getByDate(personId: EntityId, date: ISODate): Promise<ScheduleEntry | null>; upsert(entry: ScheduleEntry): Promise<void>; transaction<T>(work: (repository: ScheduleRepository) => Promise<T>): Promise<T>; }
export interface PlaceRepository { get(personId: EntityId, kind: PlaceKind): Promise<Place | null>; save(place: Place): Promise<void>; }
export interface CommuteRepository {
  listAccessPoints(personId: EntityId, kind: PlaceKind): Promise<TransitAccessPoint[]>;
  upsertAccessPoint(point: TransitAccessPoint): Promise<void>;
  setAccessPointSelected(accessPointId: EntityId, selected: boolean): Promise<void>;
  setAccessPointAlias(accessPointId: EntityId, userLabel: string): Promise<void>;
  setSelectedBusRoute(accessPointId: EntityId, providerRouteId: string): Promise<void>;
  getRoutePreference(personId: EntityId): Promise<RoutePreference | null>;
  saveRoutePreference(preference: RoutePreference): Promise<void>;
  listRouteCandidates(personId: EntityId): Promise<RouteCandidate[]>;
  getPreferredRouteCandidateId(personId: EntityId): Promise<EntityId | null>;
  setPreferredRouteCandidateId(personId: EntityId, routeCandidateId: EntityId): Promise<void>;
}
export interface ImportRepository { getCurrentBatch(): Promise<ImportBatch | null>; getBatch(batchId: EntityId): Promise<ImportBatch | null>; replaceFiles(batchId: EntityId, files: ImportFileRecord[]): Promise<void>; setDetectedPersonMatch(batchId: EntityId, detectedPersonId: EntityId, personId: EntityId | null): Promise<void>; setResolution(batchId: EntityId, reviewItemId: EntityId, resolution: ImportResolution): Promise<void>; markCommitted(batchId: EntityId): Promise<void>; }
export interface NotificationRepository { getSettings(): Promise<NotificationSettings>; setRules(rules: NotificationRules): Promise<void>; setPermission(permission: NotificationSettings['permission']): Promise<void>; }
export interface TodayRepository { get(personId: EntityId): Promise<TodaySnapshot | null>; }
