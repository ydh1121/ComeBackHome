import type { EntityId, ISODate } from '../../domain/common';
import type { Address, Coordinate, ImportResolution, NotificationRules, Person, Place, PlaceKind, RouteCandidate, SavedCommuteRoute, TransitAccessPoint, TransitMode } from '../../domain/models';

export type ImportInputFile = { kind: 'WORKBOOK'; file: File } | { kind: 'IMAGE'; file: File };
export interface ImportFileSelectionAction { accept(files: ImportInputFile[], signal?: AbortSignal): Promise<EntityId>; }
export interface CommitImportReviewAction { execute(batchId: EntityId): Promise<void>; }
export interface ImportMatchActions {
  setPendingPersonCreate(batchId: EntityId, detectedPersonId: EntityId, pending: boolean): Promise<void>;
  addManualPerson(batchId: EntityId, personId: EntityId): Promise<void>;
  cyclePersonMatch(batchId: EntityId, detectedPersonId: EntityId): Promise<void>;
  setPendingNewPerson(batchId: EntityId, detectedPersonId: EntityId, proposedName: string): Promise<void>; setPersonMatch(batchId: EntityId, detectedPersonId: EntityId, personId: EntityId | null): Promise<void>;
  setPersonIgnored(batchId: EntityId, detectedPersonId: EntityId, ignored: boolean): Promise<void>;
}
export interface ImportReviewActions {
  setImportedDate(batchId: EntityId, reviewItemId: EntityId, date: ISODate): Promise<void>;
  setWeeklyStartDate(batchId: EntityId, startDate: ISODate): Promise<void>;
  confirmWeeklyDates(batchId: EntityId): Promise<void>;
  setResolution(batchId: EntityId, reviewItemId: EntityId, resolution: ImportResolution): Promise<void>;
  setImportedTime(batchId: EntityId, reviewItemId: EntityId, field: 'start' | 'end', value: string | null): Promise<void>;
  setImportedBreakMinutes(batchId: EntityId, reviewItemId: EntityId, minutes: number | null): Promise<void>;
  setImportedEnabled(batchId: EntityId, reviewItemId: EntityId, enabled: boolean): Promise<void>;
}
export type TransitAccessFilter = 'all' | Lowercase<TransitMode>;
export interface TransitAccessActions {
  setFilter(kind: PlaceKind, filter: TransitAccessFilter): void;
  toggleAccess(accessPointId: EntityId, selected: boolean): Promise<void>;
}
export interface NotificationActions {
  syncCurrentSubscription(): Promise<void>;
  connectPushFromUserGesture(): Promise<void>;
  requestPermissionFromUserGesture(): Promise<void>;
  disablePushSubscription(): Promise<void>;
  updateRules(rules: NotificationRules): Promise<void>;
  sendTestNotification(): Promise<void>;
}
export interface PersonSelectionActions {
  getSelectedPersonId(): EntityId | null;
  select(personId: EntityId): void;
}
export type PersonInput = Omit<Person,'id'>;
export interface PersonActions {
  create(input: PersonInput): Promise<Person>;
  update(personId: EntityId, input: PersonInput): Promise<Person>;
}
export interface ScheduleDayInput {
  enabled: boolean;
  start: string;
  end: string;
  breakMinutes?: number | null;
  expectedPersonId?: EntityId;
}
export interface ScheduleBulkRule {
  from: ISODate;
  to: ISODate;
  weekdays: number[];
  start: string;
  end: string;
  expectedPersonId?: EntityId;
}
export interface ScheduleActions {
  removeRange(from: ISODate, to: ISODate, expectedCount: number, expectedPersonId: EntityId): Promise<number>;
  saveDay(date: ISODate, input: ScheduleDayInput): Promise<void>;
  applyBulk(rule: ScheduleBulkRule): Promise<void>;
}

export interface PlaceInput {
  label: string;
  address: Address;
  coordinate?: Coordinate;
  providerPlaceId?: string;
}
export interface PlaceActions {
  search(query: string): Promise<Array<{ providerId: string; placeName?: string; roadAddress: string; lotAddress?: string; coordinate: Coordinate; category?: string }>>;
  save(personId: EntityId, kind: PlaceKind, input: PlaceInput): Promise<Place>;
}
export interface CommuteActions {
  selectRouteCandidate(personId: EntityId, routeCandidateId: EntityId): Promise<void>;
  createSavedRoute(personId: EntityId): Promise<SavedCommuteRoute>;
  selectSavedRoute(personId: EntityId, routeId: EntityId): Promise<void>;
  setRouteOriginAccess(personId: EntityId, routeId: EntityId, accessPointId: EntityId): Promise<void>;
  setRouteDestinationAccess(personId: EntityId, routeId: EntityId, accessPointId: EntityId): Promise<void>;
  addRouteOriginAccess(personId: EntityId, routeId: EntityId, accessPointId: EntityId): Promise<void>;
  removeRouteOriginAccess(personId: EntityId, routeId: EntityId, accessPointId: EntityId): Promise<void>;
  addRouteDestinationAccess(personId: EntityId, routeId: EntityId, accessPointId: EntityId): Promise<void>;
  removeRouteDestinationAccess(personId: EntityId, routeId: EntityId, accessPointId: EntityId): Promise<void>;
  moveRouteVia(personId: EntityId, routeId: EntityId, fromIndex: number, toIndex: number): Promise<void>;
  addRouteVia(personId: EntityId, routeId: EntityId, accessPointId: EntityId, index?: number): Promise<void>;
  replaceRouteVia(personId: EntityId, routeId: EntityId, index: number, accessPointId: EntityId): Promise<void>;
  removeRouteVia(personId: EntityId, routeId: EntityId, index: number): Promise<void>;
  movePreferenceStep(personId: EntityId, fromIndex: number, toIndex: number): Promise<void>;
  addPreferenceStep(personId: EntityId, accessPointId: EntityId, index?: number): Promise<void>;
  replacePreferenceStep(personId: EntityId, index: number, accessPointId: EntityId): Promise<void>;
}
export interface TransitSearchActions {
  searchDetailed?(personId: EntityId, kind: PlaceKind, query: string, center?: Coordinate):
    Promise<import('./providers').TransitLookupResult>;
  nearbyDetailed?(personId: EntityId, kind: PlaceKind, center?: Coordinate):
    Promise<import('./providers').TransitLookupResult>;
  search(personId: EntityId, kind: PlaceKind, query: string, center?: Coordinate): Promise<Array<{ id: string; providerId: string; mode: TransitMode; name: string; displayCode?: string; line?: string; walkMinutes?: number; distanceM?: number; coordinate?: Coordinate; routeCount?: number }>>;
  nearby(personId: EntityId, kind: PlaceKind, center?: Coordinate): Promise<Array<{ id: string; providerId: string; mode: TransitMode; name: string; displayCode?: string; line?: string; walkMinutes?: number; distanceM?: number; coordinate?: Coordinate; routeCount?: number }>>;
  addAccessPoint(personId: EntityId, kind: PlaceKind, resultId: string): Promise<TransitAccessPoint>;
}
export interface BusRouteActions {
  listRoutes(personId: EntityId, kind: PlaceKind, accessPointId: EntityId): Promise<import('../../domain/models').BusRouteOption[]>;
  setAlias(accessPointId: EntityId, userLabel: string): Promise<void>;
  selectRoute(accessPointId: EntityId, providerRouteId: string): Promise<void>;
}
