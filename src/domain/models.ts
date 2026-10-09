import type { EntityId, ISODate, ISODateTime, PermissionState } from './common';
export interface Person { id: EntityId; name: string; relation: string; }
export interface Address { road: string; lot?: string; detail?: string; }
export interface Coordinate { x: number; y: number; }
export type PlaceKind = 'origin' | 'destination';
export interface Place { id: EntityId; personId: EntityId; kind: PlaceKind; label: string; address: Address; coordinate?: Coordinate; providerPlaceId?: string; }
export interface ScheduleEntry { id: EntityId; personId: EntityId; date: ISODate; enabled: boolean; start: string; end: string; breakMinutes?: number | null; }
export type TransitMode = 'BUS' | 'SUBWAY';
export type CommuteLegMode = 'WALK' | 'BUS' | 'SUBWAY' | 'TRANSFER';
export type CommuteStepType = 'WALKING' | 'BUS' | 'SUBWAY' | 'TRANSFER';
export interface CommuteStep { type: CommuteStepType; label: string; }
export interface TransitAccessPoint { id: EntityId; personId: EntityId; providerId: string; placeKind: PlaceKind; mode: TransitMode; name: string; displayCode?: string; line?: string; coordinate?: Coordinate; distanceM?: number; walkMinutes?: number; selected: boolean; userLabel?: string; busRoutes?: BusRouteOption[]; selectedBusRouteId?: string; }
export interface BusRouteOption { providerRouteId: string; routeNo: string; directionLabel: string; terminalName?: string; routeType?: string; }
export interface RoutePreference { id: EntityId; personId: EntityId; originPlaceKind: 'origin'; destinationPlaceKind: 'destination'; viaAccessPointIds: EntityId[]; preferredModes?: TransitMode[]; }
export interface SavedCommuteRoute { id: EntityId; personId: EntityId; position: number; label: string; originAccessPointIds?: EntityId[]; destinationAccessPointIds?: EntityId[]; /** @deprecated compatibility field; use originAccessPointIds */ originAccessPointId?: EntityId; /** @deprecated compatibility field; use destinationAccessPointIds */ destinationAccessPointId?: EntityId; viaAccessPointIds: EntityId[]; active: boolean; }
export interface RouteCandidate { id: EntityId; personId: EntityId; totalMinutes: number; transferCount: number; walkMinutes: number; accessMinutes?: number; egressMinutes?: number; fare?: number; policyLabels?: string[]; matchesPreference?: boolean; preferenceMatchScore?: number; steps?: CommuteStep[]; }
export type ImportResolution = 'KEEP' | 'NEW' | 'SKIP';
export type ImportFileKind = 'XLSX' | 'IMAGE';
export type ImportFileStatus = 'WAITING' | 'PARSING' | 'READY' | 'ERROR';
export interface ImportFileRecord { id: EntityId; name: string; kind: ImportFileKind; progress: number; status: ImportFileStatus; message?: string; }
export interface DetectedImportPerson { id: EntityId; sourceName: string; matchedPersonId: EntityId | null; confidence: number; ignored?: boolean; }
export interface ImportStructure { sheet: string; headerRow: number; personColumn: string; dateColumn: string; shiftColumn: string; needsReview: boolean; }
export type ImportRecognitionState = 'WORK' | 'INCOMPLETE' | 'OFF' | 'OFF_CANDIDATE' | 'UNREADABLE';
export interface ImportReviewItem { id: EntityId; detectedPersonId: EntityId; personId: EntityId | null; date: ISODate; existing?: Pick<ScheduleEntry,'enabled'|'start'|'end'|'breakMinutes'>; imported: { enabled: boolean; start: string | null; end: string | null; breakMinutes?: number | null }; recognitionState?: ImportRecognitionState; resolution: ImportResolution | null; }
export interface ImportBatch {
  id: EntityId;
  files: ImportFileRecord[];
  detectedPeople: DetectedImportPerson[];
  structure: ImportStructure;
  reviewItems: ImportReviewItem[];
  committed: boolean;
}
export interface NotificationRules { shiftEnd: boolean; etaChange: boolean; leftWork: boolean; homeArrival: boolean; }
export interface WebPushSubscriptionRecord {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}
export interface NotificationSettings { permission: PermissionState; rules: NotificationRules; subscription?: WebPushSubscriptionRecord | null; }
export interface PresenceState {
  personId: EntityId;
  workDate: ISODate;
  leftWorkAt?: ISODateTime;
  arrivedHomeAt?: ISODateTime;
}
export interface EtaSnapshot { personId: EntityId; status: 'ACTUAL' | 'LIVE' | 'STALE' | 'FALLBACK' | 'UNKNOWN'; arrivalTime?: string; freshnessMinutes?: number; calculatedAt?: ISODateTime; }
export interface TodaySnapshot { personId: EntityId; eta: EtaSnapshot; shiftEnd?: string; leftWorkAt?: ISODateTime; arrivedHomeAt?: ISODateTime; routeCandidateId?: EntityId; }
