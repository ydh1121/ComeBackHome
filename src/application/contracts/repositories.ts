import type { ImportBatch, ImportFileRecord, ImportResolution, NotificationRules, NotificationSettings, Person, Place, PlaceKind, PresenceState, RouteCandidate, RoutePreference, SavedCommuteRoute, ScheduleEntry, TodaySnapshot, TransitAccessPoint, WebPushSubscriptionRecord } from '../../domain/models';
import type { EntityId, ISODate } from '../../domain/common';
export interface PersonRepository { list(): Promise<Person[]>; get(id: EntityId): Promise<Person | null>; create(input: Omit<Person,'id'>): Promise<Person>; update(id: EntityId, patch: Partial<Omit<Person,'id'>>): Promise<Person>; }
export interface ApprovedImportSchedule {
  id: EntityId;
  personId?: EntityId;
  pendingPersonRef?: string;
  date: ISODate;
  dayIndex: number;
  enabled: boolean;
  start: string;
  end: string;
  breakMinutes?: number | null;
  decision: 'NEW';
  approved: true;
  recognitionState?: 'OFF_CANDIDATE';
  offApproved?: boolean;
  breakReviewRequired?: boolean;
}
export interface ApprovedWeeklyImport {
  requestId: EntityId;
  weekStart: ISODate;
  confirmed: true;
  newPeople: Array<{ ref: string; name: string }>;
  schedules: ApprovedImportSchedule[];
}
export interface ApprovedImportReceipt {
  createdPeople: Record<string, EntityId>;
  schedules: ScheduleEntry[];
}
export interface ScheduleRepository {
  list(personId: EntityId): Promise<ScheduleEntry[]>;
  getByDate(personId: EntityId, date: ISODate): Promise<ScheduleEntry | null>;
  upsert(entry: ScheduleEntry): Promise<void>;
  upsertMany(entries: ScheduleEntry[]): Promise<void>;
  /** Optional only for legacy mock/workbook compatibility; required for weekly pending people. */
  importApprovedWeekly?(importData: ApprovedWeeklyImport): Promise<ApprovedImportReceipt>;
}
export interface PlaceRepository { get(personId: EntityId, kind: PlaceKind): Promise<Place | null>; save(place: Place): Promise<void>; }
export type RouteSearchSource = 'ROUTE_ACCESS' | 'SELECTED_ACCESS' | 'PLACE';
export type RouteProviderErrorCategory = 'NONE' | 'AUTH' | 'HTTP' | 'NO_RESULT' | 'INVALID_COORDINATE' | 'QUOTA' | 'UNKNOWN';
export interface RouteSearchDiagnostics {
  status: 'OK' | 'NO_RESULT' | 'PROVIDER_ERROR' | 'MISSING_PLACE' | 'INVALID_COORDINATE' | 'RUNTIME_DISABLED' | 'QUOTA_EXCEEDED';
  originPlaceCoordinatePresent: boolean;
  destinationPlaceCoordinatePresent: boolean;
  selectedOriginCount: number;
  selectedDestinationCount: number;
  routeSpecificOriginCount: number;
  routeSpecificDestinationCount: number;
  staleAccessIdCount: number;
  searchPairCount: number;
  successfulPairCount: number;
  failedPairCount: number;
  totalRouteResultCount: number;
  dedupedCandidateCount: number;
  placeFallbackUsed: boolean;
  pairs: Array<{
    originSource: RouteSearchSource;
    destinationSource: RouteSearchSource;
    providerResultCount: number;
    errorCategory: RouteProviderErrorCategory;
  }>;
}
export interface RouteDiscovery { candidates: RouteCandidate[]; diagnostics: RouteSearchDiagnostics; }
export interface CommuteRepository {
  listAccessPoints(personId: EntityId, kind: PlaceKind): Promise<TransitAccessPoint[]>;
  upsertAccessPoint(point: TransitAccessPoint): Promise<void>;
  setAccessPointSelected(accessPointId: EntityId, selected: boolean): Promise<void>;
  setAccessPointAlias(accessPointId: EntityId, userLabel: string): Promise<void>;
  setSelectedBusRoute(accessPointId: EntityId, providerRouteId: string): Promise<void>;
  getRoutePreference(personId: EntityId): Promise<RoutePreference | null>;
  saveRoutePreference(preference: RoutePreference): Promise<void>;
  listSavedRoutes(personId: EntityId): Promise<SavedCommuteRoute[]>;
  createSavedRoute(personId: EntityId): Promise<SavedCommuteRoute>;
  saveSavedRoute(route: SavedCommuteRoute): Promise<void>;
  setActiveSavedRoute(personId: EntityId, routeId: EntityId): Promise<void>;
  listRouteCandidates(personId: EntityId): Promise<RouteCandidate[]>;
  inspectRouteCandidates?(personId: EntityId): Promise<RouteDiscovery>;
  getPreferredRouteCandidateId(personId: EntityId): Promise<EntityId | null>;
  setPreferredRouteCandidateId(personId: EntityId, routeCandidateId: EntityId): Promise<void>;
}
export interface ImportRepository { getCurrentBatch(): Promise<ImportBatch | null>; getBatch(batchId: EntityId): Promise<ImportBatch | null>; createBatch(): Promise<ImportBatch>; replaceFiles(batchId: EntityId, files: ImportFileRecord[]): Promise<void>; replaceParsedResult(batchId: EntityId, result: Pick<ImportBatch,'detectedPeople'|'structure'|'reviewItems'>): Promise<void>; addManualPerson(batchId: EntityId, personId: EntityId, name: string): Promise<void>; setWeeklyStartDate(batchId: EntityId, startDate: ISODate): Promise<void>; confirmWeeklyDates(batchId: EntityId): Promise<void>; setPendingNewPerson(batchId: EntityId, detectedPersonId: EntityId, proposedName: string): Promise<void>; setDetectedPersonMatch(batchId: EntityId, detectedPersonId: EntityId, personId: EntityId | null): Promise<void>; setDetectedPersonIgnored(batchId: EntityId, detectedPersonId: EntityId, ignored: boolean): Promise<void>; setResolution(batchId: EntityId, reviewItemId: EntityId, resolution: ImportResolution): Promise<void>; setImportedTime(batchId: EntityId, reviewItemId: EntityId, field: 'start' | 'end', value: string | null): Promise<void>; setImportedBreakMinutes(batchId: EntityId, reviewItemId: EntityId, minutes: number | null): Promise<void>; setImportedEnabled(batchId: EntityId, reviewItemId: EntityId, enabled: boolean): Promise<void>; markCommitted(batchId: EntityId): Promise<void>; }
export interface NotificationRepository { getSettings(): Promise<NotificationSettings>; setRules(rules: NotificationRules): Promise<void>; setPermission(permission: NotificationSettings['permission']): Promise<void>; setSubscription(subscription: WebPushSubscriptionRecord | null): Promise<void>; }
export interface TodayRepository { get(personId: EntityId): Promise<TodaySnapshot | null>; }

export interface PresenceRepository {
  get(personId: EntityId): Promise<PresenceState | null>;
  record(input: { eventId: string; personId: EntityId; type: 'LEFT_WORK' | 'ARRIVED_HOME'; acceptedAt: string; workDate: ISODate }): Promise<{ state: PresenceState; duplicate: boolean }>;
}
