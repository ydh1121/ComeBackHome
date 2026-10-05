import type {
  KakaoMapSource,
  ProviderRequestContext,
  SeoulBusSource,
  SeoulSubwaySource,
} from './contracts';
import {
  mapKakaoPlaceSearch,
  mapKakaoPublicTransitRoutes,
  mapSeoulBusArrivals,
  mapSeoulBusStops,
  mapSeoulSubwayArrivals,
  mapSeoulSubwayStations,
  mapSeoulSubwayTrainPositions,
} from './mappers';
import type { ProviderJsonRequest, ProviderJsonTransport } from './transport';
import type { Coordinate } from '../../src/domain/models';

function kakaoAuth(): ProviderJsonRequest['auth'] {
  return {
    secretName: 'KAKAO_REST_API_KEY',
    placement: 'header',
    target: 'Authorization',
    prefix: 'KakaoAK ',
  };
}

function seoulBusAuth(): ProviderJsonRequest['auth'] {
  return {
    secretName: 'SEOUL_BUS_SERVICE_KEY',
    placement: 'query',
    target: 'serviceKey',
  };
}

function seoulSubwayAuth(): ProviderJsonRequest['auth'] {
  return {
    secretName: 'SEOUL_SUBWAY_API_KEY',
    placement: 'path',
    target: '{SEOUL_SUBWAY_API_KEY}',
  };
}

export class KakaoMapRequestClient implements KakaoMapSource {
  constructor(private readonly transport: ProviderJsonTransport) {}

  async searchPlaces(query: string, near?: Coordinate, context?: ProviderRequestContext) {
    const request: ProviderJsonRequest = {
      source: 'kakao-map',
      capability: 'keyword-place-search',
      method: 'GET',
      urlTemplate: 'https://dapi.kakao.com/v2/local/search/keyword.json',
      query: {
        query,
        ...(near ? {
          x: String(near.x),
          y: String(near.y),
          sort: 'distance',
        } : {}),
      },
      auth: kakaoAuth(),
      security: 'TLS_VERIFIED',
    };
    return mapKakaoPlaceSearch(await this.transport.getJson(request, context));
  }

  async publicTransitRoutes(origin: Coordinate, destination: Coordinate, context?: ProviderRequestContext) {
    const request: ProviderJsonRequest = {
      source: 'kakao-map',
      capability: 'public-transit-routing',
      method: 'GET',
      urlTemplate: 'https://dapi.kakao.com/v2/routing/publictraffic',
      query: {
        start_x: String(origin.x),
        start_y: String(origin.y),
        end_x: String(destination.x),
        end_y: String(destination.y),
        input_coord: 'WGS84',
        output_coord: 'WGS84',
      },
      auth: kakaoAuth(),
      security: 'TLS_VERIFIED',
    };
    return mapKakaoPublicTransitRoutes(await this.transport.getJson(request, context));
  }
}

export class SeoulBusRequestClient implements SeoulBusSource {
  constructor(private readonly transport: ProviderJsonTransport) {}

  async searchStops(query: string, _near: Coordinate, context?: ProviderRequestContext) {
    const request: ProviderJsonRequest = {
      source: 'seoul-bus',
      capability: 'bus-stop-name-search',
      method: 'GET',
      urlTemplate: 'http://ws.bus.go.kr/api/rest/stationinfo/getStationByName',
      query: {
        stSrch: query,
        resultType: 'json',
      },
      auth: seoulBusAuth(),
      security: 'DOCUMENTED_HTTP_REQUIRES_VALIDATION',
    };
    return mapSeoulBusStops(await this.transport.getJson(request, context));
  }

  async arrivals(stopProviderId: string, routeProviderId: string, context?: ProviderRequestContext) {
    const request: ProviderJsonRequest = {
      source: 'seoul-bus',
      capability: 'bus-route-all-arrivals',
      method: 'GET',
      urlTemplate: 'http://ws.bus.go.kr/api/rest/arrive/getArrInfoByRouteAll',
      query: {
        busRouteId: routeProviderId,
        resultType: 'json',
      },
      auth: seoulBusAuth(),
      security: 'DOCUMENTED_HTTP_REQUIRES_VALIDATION',
    };
    return mapSeoulBusArrivals(
      await this.transport.getJson(request, context),
      routeProviderId,
      stopProviderId,
    );
  }
}

export class SeoulSubwayRequestClient implements SeoulSubwaySource {
  constructor(private readonly transport: ProviderJsonTransport) {}

  async searchStations(query: string, _near: Coordinate, context?: ProviderRequestContext) {
    const request: ProviderJsonRequest = {
      source: 'seoul-subway',
      capability: 'subway-station-name-search',
      method: 'GET',
      urlTemplate: 'http://openAPI.seoul.go.kr:8088/{SEOUL_SUBWAY_API_KEY}/json/SearchInfoBySubwayNameService/1/20/{stationName}/',
      pathParams: { stationName: query },
      auth: seoulSubwayAuth(),
      security: 'DOCUMENTED_HTTP_REQUIRES_VALIDATION',
    };
    return mapSeoulSubwayStations(await this.transport.getJson(request, context));
  }

  async arrivals(stationName: string, _line?: string, context?: ProviderRequestContext) {
    const request: ProviderJsonRequest = {
      source: 'seoul-subway',
      capability: 'realtime-subway-arrivals',
      method: 'GET',
      urlTemplate: 'http://swopenAPI.seoul.go.kr/api/subway/{SEOUL_SUBWAY_API_KEY}/json/realtimeStationArrival/0/20/{stationName}',
      pathParams: { stationName },
      auth: seoulSubwayAuth(),
      security: 'DOCUMENTED_HTTP_REQUIRES_VALIDATION',
    };
    return mapSeoulSubwayArrivals(await this.transport.getJson(request, context));
  }

  async trainPositions(line: string, context?: ProviderRequestContext) {
    const request: ProviderJsonRequest = {
      source: 'seoul-subway',
      capability: 'realtime-subway-position',
      method: 'GET',
      urlTemplate: 'http://swopenAPI.seoul.go.kr/api/subway/{SEOUL_SUBWAY_API_KEY}/json/realtimePosition/0/100/{line}',
      pathParams: { line },
      auth: seoulSubwayAuth(),
      security: 'DOCUMENTED_HTTP_REQUIRES_VALIDATION',
    };
    return mapSeoulSubwayTrainPositions(await this.transport.getJson(request, context));
  }
}
