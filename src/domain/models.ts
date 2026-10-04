import type { EntityId, ISODate, ISODateTime, PermissionState } from './common';
export interface Person { id: EntityId; name: string; relation: string; }
export interface Address { road: string; lot?: string; detail?: string; }
export interface Coordinate { x: number; y: number; }
export type PlaceKind = 'origin' | 'destination';
export interface Place { id: EntityId; personId: EntityId; kind: PlaceKind; label: string; address: Address; coordinate?: Coordinate; providerPlaceId?: string; }
export interface ScheduleEntry { id: EntityId; personId: EntityId; date: ISODate; enabled: boolean; start: string; end: string; }
export type TransitMode = 'BUS' | 'SUBWAY';
export type CommuteLegMode = 'WALK' | 'BUS' | 'SUBWAY' | 'TRANSFER';
export interface TransitAccessPoint { id: EntityId; providerId: string; placeKind: PlaceKind; mode: TransitMode; name: string; displayCode?: string; line?: string; walkMinutes?: number; selected: boolean; userLabel?: string; }
export interface BusRouteOption { providerRouteId: string; routeNo: string; directionLabel: string; terminalName?: string; routeType?: string; }
export interface RoutePreference { id: EntityId; personId: EntityId; originPlaceKind: 'origin'; destinationPlaceKind: 'destination'; viaAccessPointIds: EntityId[]; preferredModes?: TransitMode[]; }
export interface RouteCandidate { id: EntityId; totalMinutes: number; transferCount: number; walkMinutes: number; }
export type ImportResolution = 'KEEP' | 'NEW';
export interface ImportReviewItem { id: EntityId; personId: EntityId; date: ISODate; existing?: Pick<ScheduleEntry,'start'|'end'>; imported: Pick<ScheduleEntry,'start'|'end'>; resolution: ImportResolution; }
export interface ImportBatch { id: EntityId; reviewItems: ImportReviewItem[]; }
export interface NotificationRules { shiftEnd: boolean; etaChange: boolean; }
export interface NotificationSettings { permission: PermissionState; rules: NotificationRules; }
export interface EtaSnapshot { personId: EntityId; status: 'LIVE' | 'STALE' | 'FALLBACK' | 'UNKNOWN'; arrivalTime?: string; freshnessMinutes?: number; calculatedAt?: ISODateTime; }
