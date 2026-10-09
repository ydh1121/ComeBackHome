import type { ISODate } from '../../domain/common';
import type { BusRouteOption, CommuteStep, Coordinate, ImportStructure, TransitMode, WebPushSubscriptionRecord } from '../../domain/models';

export interface PlaceSearchResult { providerId: string; placeName?: string; roadAddress: string; lotAddress?: string; coordinate: Coordinate; category?: string; }
export interface TransitSearchResult { id: string; providerId: string; mode: TransitMode; name: string; displayCode?: string; line?: string; walkMinutes?: number; distanceM?: number; routeCount?: number; coordinate?: Coordinate; busRoutes?: BusRouteOption[]; }
export interface Arrival { providerVehicleId?: string; minutes: number; observedAt: string; }
export interface TransitBusLeg { stopNames: string[]; routes: BusRouteOption[]; }
export interface TransitRouteResult { id: string; totalMinutes: number; transferCount: number; walkMinutes?: number; accessMinutes?: number; egressMinutes?: number; fare?: number; steps?: CommuteStep[]; busLegs?: TransitBusLeg[]; }
export interface PlaceSearchProvider { search(query: string): Promise<PlaceSearchResult[]>; }
export interface TransitRouteProvider { search(origin: Coordinate, destination: Coordinate): Promise<TransitRouteResult[]>; }
export interface TransitAccessSearchProvider {
  search(query: string, near: Coordinate): Promise<TransitSearchResult[]>;
  nearby(near: Coordinate): Promise<TransitSearchResult[]>;
  resolve(result: TransitSearchResult, near: Coordinate): Promise<TransitSearchResult>;
}
export interface BusRouteLookupProvider { listByStop(arsId: string): Promise<BusRouteOption[]>; }
export interface RealtimeBusProvider { arrivals(stopProviderId: string, routeProviderId: string): Promise<Arrival[]>; }
export interface RealtimeSubwayProvider { arrivals(providerStationId: string, stationName: string, line?: string): Promise<Arrival[]>; }
export interface ParsedImportPerson { sourceName: string; confidence: number; }
export interface ParsedScheduleCandidate { sourcePersonName: string; date: ISODate; start: string; end: string; sourceRow: number; confidence: number; }
export type ImageScheduleCellState = 'INCOMPLETE' | 'OFF' | 'OFF_CANDIDATE' | 'UNREADABLE';
export interface ParsedScheduleReviewCandidate { sourcePersonName: string; date: ISODate; start: string | null; end: string | null; sourceRow: number; confidence: number; recognitionState?: ImageScheduleCellState; enabled?: boolean; }
export interface ParsedImport { detectedPeople: ParsedImportPerson[]; scheduleCandidates: ParsedScheduleCandidate[]; reviewCandidates?: ParsedScheduleReviewCandidate[]; structure: ImportStructure; confidence: number; }
export interface WorkbookParser { parse(data: ArrayBuffer): Promise<ParsedImport>; }
export interface ImageTextToken { text: string; x: number; y: number; width: number; height: number; confidence: number; }
export interface ImageTextLayout { width: number; height: number; tokens: ImageTextToken[]; }
export type ImportProgressReporter = (progress: number) => void | Promise<void>;
export interface ImageTextExtractor { extract(file: File, onProgress?: ImportProgressReporter): Promise<ImageTextLayout>; }
export interface ImageTextProbeRegion {
  id: string;
  purpose: 'person' | 'cell' | 'date';
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ImageTextProbeResult {
  id: string;
  purpose: ImageTextProbeRegion['purpose'];
  text: string;
  tokens: ImageTextToken[];
  confidence: number;
}
export interface RegionalImageTextExtractor extends ImageTextExtractor {
  extractRegions(
    file: File,
    regions: ImageTextProbeRegion[],
    onProgress?: ImportProgressReporter,
  ): Promise<ImageTextProbeResult[]>;
}
export interface PreparedImageRaster {
  image: File | Blob;
  sourceWidth: number;
  sourceHeight: number;
  rasterWidth: number;
  rasterHeight: number;
}
export interface ImageRasterPreprocessor { prepare(file: File): Promise<PreparedImageRaster>; }
export interface ImageScheduleRecognizer { parse(file: File, onProgress?: ImportProgressReporter): Promise<ParsedImport>; }
export interface NotificationPermissionProvider { getPermission(): Promise<NotificationPermission>; requestPermissionFromUserGesture(): Promise<NotificationPermission>; }
export interface PushSubscriptionProvider { getCurrent(): Promise<WebPushSubscriptionRecord | null>; subscribe(): Promise<WebPushSubscriptionRecord>; unsubscribe(): Promise<void>; isCompatible?(): Promise<boolean>; prepare?(): Promise<void>; }
export interface PushSubscriptionTransport { upsert(subscription: WebPushSubscriptionRecord): Promise<void>; remove(endpoint: string): Promise<void>; checkRegistered?(endpoint: string): Promise<boolean>; }
export interface NotificationTestGateway { sendTestNotification(): Promise<void>; }

export interface PresenceAutomationGateway {
  getStatus(): Promise<{ configured: boolean }>;
  validateToken(token: string): Promise<boolean>;
}
