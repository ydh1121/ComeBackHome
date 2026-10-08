import type { BusRouteOption, Coordinate } from '../../src/domain/models';
import type { Arrival, PlaceSearchResult, TransitRouteResult, TransitSearchResult } from '../../src/application/contracts/providers';

export type ProviderSourceId = 'kakao-map' | 'seoul-bus' | 'seoul-subway';
export type ProviderCoverage = 'KOREA' | 'SEOUL' | 'SEOUL_METRO_PARTIAL';

export interface ProviderSecretBindings {
  KAKAO_REST_API_KEY?: string;
  SEOUL_BUS_SERVICE_KEY?: string;
  SEOUL_OPENAPI_KEY?: string;
  SEOUL_SUBWAY_API_KEY?: string;
}

export interface ProviderRequestContext {
  signal?: AbortSignal;
  fetchedAt: string;
}

export interface KakaoStaticMapImage {
  body: ArrayBuffer;
  contentType: string;
}

export interface KakaoMapSource {
  searchPlaces(query: string, near?: Coordinate, context?: ProviderRequestContext): Promise<PlaceSearchResult[]>;
  publicTransitRoutes(origin: Coordinate, destination: Coordinate, context?: ProviderRequestContext): Promise<TransitRouteResult[]>;
  staticMap(center: Coordinate, markers: Coordinate[], context?: ProviderRequestContext): Promise<KakaoStaticMapImage>;
}

export interface SeoulBusSource {
  nearbyStops(near: Coordinate, radiusM?: number, context?: ProviderRequestContext): Promise<TransitSearchResult[]>;
  searchStops(query: string, near: Coordinate, context?: ProviderRequestContext): Promise<TransitSearchResult[]>;
  routesByStop(arsId: string, context?: ProviderRequestContext): Promise<BusRouteOption[]>;
  arrivals(stopProviderId: string, routeProviderId: string, context?: ProviderRequestContext): Promise<Arrival[]>;
}

export interface SeoulSubwaySource {
  searchStations(query: string, near?: Coordinate, context?: ProviderRequestContext): Promise<TransitSearchResult[]>;
  arrivals(stationName: string, line?: string, context?: ProviderRequestContext): Promise<Arrival[]>;
  trainPositions(line: string, context?: ProviderRequestContext): Promise<SubwayTrainPosition[]>;
}

export interface SubwayTrainPosition {
  providerTrainId: string;
  line: string;
  stationName: string;
  observedAt: string;
  direction?: string;
  terminalName?: string;
  status?: string;
  express?: boolean;
}

export interface ProviderSourceBundle {
  kakao: KakaoMapSource;
  seoulBus: SeoulBusSource;
  seoulSubway: SeoulSubwaySource;
}

export interface ProviderFreshnessPolicy {
  classify(observedAt: string, now: Date): 'LIVE' | 'STALE';
}

export interface ProviderFallbackPolicy {
  realtimeUnavailable(reason: 'OUT_OF_COVERAGE' | 'STALE' | 'ERROR' | 'RATE_LIMIT'): 'FALLBACK' | 'UNKNOWN';
}
