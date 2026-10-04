import type { Coordinate, RouteCandidate, TransitMode } from '../../domain/models';

export interface PlaceSearchResult { providerId: string; placeName?: string; roadAddress: string; lotAddress?: string; coordinate: Coordinate; category?: string; }
export interface TransitSearchResult { id: string; providerId: string; mode: TransitMode; name: string; displayCode?: string; line?: string; walkMinutes?: number; distanceM?: number; routeCount?: number; }
export interface Arrival { providerVehicleId?: string; minutes: number; observedAt: string; }
export interface PlaceSearchProvider { search(query: string): Promise<PlaceSearchResult[]>; }
export interface TransitRouteProvider { search(origin: Coordinate, destination: Coordinate): Promise<RouteCandidate[]>; }
export interface TransitAccessSearchProvider { search(query: string, near: Coordinate): Promise<TransitSearchResult[]>; }
export interface RealtimeBusProvider { arrivals(stopProviderId: string, routeProviderId: string): Promise<Arrival[]>; }
export interface RealtimeSubwayProvider { arrivals(providerStationId: string, line?: string): Promise<Arrival[]>; }
export interface ParsedImport { detectedPeople: unknown[]; scheduleCandidates: unknown[]; confidence: number; }
export interface WorkbookParser { parse(data: ArrayBuffer): Promise<ParsedImport>; }
export interface ImageScheduleRecognizer { parse(file: File): Promise<ParsedImport>; }
export interface NotificationPermissionProvider { getPermission(): Promise<NotificationPermission>; requestPermissionFromUserGesture(): Promise<NotificationPermission>; }
export interface PushSubscriptionProvider { getCurrent(): Promise<PushSubscription | null>; subscribe(): Promise<PushSubscription>; unsubscribe(): Promise<void>; }
export interface NotificationTestGateway { sendTestNotification(): Promise<void>; }
