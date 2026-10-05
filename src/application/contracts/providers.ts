import type { ISODate } from '../../domain/common';
import type { BusRouteOption, CommuteStep, Coordinate, ImportStructure, TransitMode, WebPushSubscriptionRecord } from '../../domain/models';

export interface PlaceSearchResult { providerId: string; placeName?: string; roadAddress: string; lotAddress?: string; coordinate: Coordinate; category?: string; }
export interface TransitSearchResult { id: string; providerId: string; mode: TransitMode; name: string; displayCode?: string; line?: string; walkMinutes?: number; distanceM?: number; routeCount?: number; busRoutes?: BusRouteOption[]; }
export interface Arrival { providerVehicleId?: string; minutes: number; observedAt: string; }
export interface TransitRouteResult { id: string; totalMinutes: number; transferCount: number; walkMinutes?: number; fare?: number; steps?: CommuteStep[]; }
export interface PlaceSearchProvider { search(query: string): Promise<PlaceSearchResult[]>; }
export interface TransitRouteProvider { search(origin: Coordinate, destination: Coordinate): Promise<TransitRouteResult[]>; }
export interface TransitAccessSearchProvider { search(query: string, near: Coordinate): Promise<TransitSearchResult[]>; }
export interface RealtimeBusProvider { arrivals(stopProviderId: string, routeProviderId: string): Promise<Arrival[]>; }
export interface RealtimeSubwayProvider { arrivals(stationName: string, line?: string): Promise<Arrival[]>; }
export interface ParsedImportPerson { sourceName: string; confidence: number; }
export interface ParsedScheduleCandidate { sourcePersonName: string; date: ISODate; start: string; end: string; sourceRow: number; confidence: number; }
export interface ParsedImport { detectedPeople: ParsedImportPerson[]; scheduleCandidates: ParsedScheduleCandidate[]; structure: ImportStructure; confidence: number; }
export interface WorkbookParser { parse(data: ArrayBuffer): Promise<ParsedImport>; }
export interface ImageScheduleRecognizer { parse(file: File): Promise<ParsedImport>; }
export interface NotificationPermissionProvider { getPermission(): Promise<NotificationPermission>; requestPermissionFromUserGesture(): Promise<NotificationPermission>; }
export interface PushSubscriptionProvider { getCurrent(): Promise<WebPushSubscriptionRecord | null>; subscribe(): Promise<WebPushSubscriptionRecord>; unsubscribe(): Promise<void>; }
export interface PushSubscriptionTransport { upsert(subscription: WebPushSubscriptionRecord): Promise<void>; remove(endpoint: string): Promise<void>; }
export interface NotificationTestGateway { sendTestNotification(): Promise<void>; }
