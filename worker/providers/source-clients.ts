import type {
  KakaoMapSource,
  ProviderRequestContext,
  SeoulBusSource,
  SeoulSubwaySource,
} from './contracts';
import {
  mapKakaoAddressSearch,
  mapKakaoPlaceSearch,
  mapKakaoPublicTransitRoutes,
  mapSeoulBusArrivals,
  mapSeoulBusRoutes,
  mapSeoulBusStops,
  mapSeoulSubwayArrivals,
  mapSeoulSubwayStations,
  mapSeoulSubwayTrainPositions,
} from './mappers';
import type { ProviderJsonRequest, ProviderJsonTransport } from './transport';
import type { Coordinate } from '../../src/domain/models';

function decodeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function firstXmlTag(xml: string, names: string[]): string | undefined {
  for (const name of names) {
    const match = new RegExp(
      '<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '>',
      'i',
    ).exec(xml);
    if (match?.[1] != null) return decodeXmlText(match[1]);
  }
  return undefined;
}

function xmlRecord(block: string): Record<string, string> {
  const record: Record<string, string> = {};
  const fieldPattern = /<([A-Za-z0-9_]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;
  for (const match of block.matchAll(fieldPattern)) {
    const name = match[1];
    const raw = match[2] ?? '';
    const withoutCdata = raw.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
    if (/<[A-Za-z0-9_]+(?:\s[^>]*)?>/.test(withoutCdata)) continue;
    record[name] = decodeXmlText(raw);
  }
  return record;
}

function parseSeoulBusPayload(payload: string): unknown {
  const trimmed = payload.trim();
  if (!trimmed) throw new Error('Seoul bus provider returned an empty response.');

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }

  const itemBlocks = [
    ...trimmed.matchAll(/<(?:itemList|StationList)(?:\s[^>]*)?>([\s\S]*?)<\/(?:itemList|StationList)>/gi),
  ];
  if (itemBlocks.length > 0) {
    return {
      msgBody: {
        itemList: itemBlocks.map((match) => xmlRecord(match[1] ?? '')),
      },
    };
  }

  const code = firstXmlTag(trimmed, ['headerCd', 'resultCode', 'returnReasonCode']);
  const message = firstXmlTag(trimmed, ['headerMsg', 'resultMsg', 'returnAuthMsg', 'errMsg']);
  if (code || message) {
    throw new Error(
      'Seoul bus provider error' +
      (code ? ' [' + code + ']' : '') +
      (message ? ': ' + message : '.'),
    );
  }

  return { msgBody: { itemList: [] } };
}

async function readSeoulBusPayload(
  transport: ProviderJsonTransport,
  request: ProviderJsonRequest,
  context?: ProviderRequestContext,
): Promise<unknown> {
  if (transport.getText) {
    return parseSeoulBusPayload(await transport.getText(request, context));
  }
  return transport.getJson(request, context);
}
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

function seoulOpenApiAuth(): ProviderJsonRequest['auth'] {
  return {
    secretName: 'SEOUL_OPENAPI_KEY',
    placement: 'path',
    target: '{SEOUL_OPENAPI_KEY}',
  };
}

function seoulSubwayRealtimeAuth(): ProviderJsonRequest['auth'] {
  return {
    secretName: 'SEOUL_SUBWAY_API_KEY',
    placement: 'path',
    target: '{SEOUL_SUBWAY_API_KEY}',
  };
}

export class KakaoMapRequestClient implements KakaoMapSource {
  constructor(private readonly transport: ProviderJsonTransport) {}

  async searchPlaces(query: string, near?: Coordinate, context?: ProviderRequestContext) {
    const keywordRequest: ProviderJsonRequest = {
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
    const keywordResults = mapKakaoPlaceSearch(
      await this.transport.getJson(keywordRequest, context),
    );
    if (keywordResults.length) return keywordResults;

    const addressRequest: ProviderJsonRequest = {
      source: 'kakao-map',
      capability: 'address-search',
      method: 'GET',
      urlTemplate: 'https://dapi.kakao.com/v2/local/search/address.json',
      query: { query },
      auth: kakaoAuth(),
      security: 'TLS_VERIFIED',
    };
    return mapKakaoAddressSearch(await this.transport.getJson(addressRequest, context));
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

  async staticMap(center: Coordinate, markers: Coordinate[], context?: ProviderRequestContext) {
    const markerValues = [
      'location:' + center.x + ',' + center.y + '|option:false',
      ...markers.slice(0, 4).map((marker) =>
        'location:' + marker.x + ',' + marker.y + '|option:false'
      ),
    ];
    const request: ProviderJsonRequest = {
      source: 'kakao-map',
      capability: 'static-map',
      method: 'GET',
      urlTemplate: 'https://dapi.kakao.com/v2/maps/staticmap',
      query: {
        center: String(center.x) + ',' + String(center.y),
        size: '640x420',
        format: 'png',
        scale: '1',
        lv: '4',
        coord: 'WGS84',
        logo_pos: 'BOTTOM_RIGHT',
        markers: markerValues,
      },
      auth: kakaoAuth(),
      security: 'TLS_VERIFIED',
    };
    return this.transport.getBytes(request, context);
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
      },
      auth: seoulBusAuth(),
      security: 'DOCUMENTED_HTTP_REQUIRES_VALIDATION',
    };
    return mapSeoulBusStops(await readSeoulBusPayload(this.transport, request, context));
  }

  async routesByStop(arsId: string, context?: ProviderRequestContext) {
    const request: ProviderJsonRequest = {
      source: 'seoul-bus',
      capability: 'bus-routes-by-stop',
      method: 'GET',
      urlTemplate: 'http://ws.bus.go.kr/api/rest/stationinfo/getRouteByStation',
      query: {
        arsId,
      },
      auth: seoulBusAuth(),
      security: 'DOCUMENTED_HTTP_REQUIRES_VALIDATION',
    };
    return mapSeoulBusRoutes(await readSeoulBusPayload(this.transport, request, context));
  }

  async arrivals(stopProviderId: string, routeProviderId: string, context?: ProviderRequestContext) {
    const request: ProviderJsonRequest = {
      source: 'seoul-bus',
      capability: 'bus-route-all-arrivals',
      method: 'GET',
      urlTemplate: 'http://ws.bus.go.kr/api/rest/arrive/getArrInfoByRouteAll',
      query: {
        busRouteId: routeProviderId,
      },
      auth: seoulBusAuth(),
      security: 'DOCUMENTED_HTTP_REQUIRES_VALIDATION',
    };
    return mapSeoulBusArrivals(
      await readSeoulBusPayload(this.transport, request, context),
      routeProviderId,
      stopProviderId,
    );
  }
}

export class SeoulSubwayRequestClient implements SeoulSubwaySource {
  constructor(private readonly transport: ProviderJsonTransport) {}

  async searchStations(query: string, _near?: Coordinate, context?: ProviderRequestContext) {
    const request: ProviderJsonRequest = {
      source: 'seoul-subway',
      capability: 'subway-station-name-search',
      method: 'GET',
      urlTemplate: 'http://openAPI.seoul.go.kr:8088/{SEOUL_OPENAPI_KEY}/json/SearchInfoBySubwayNameService/1/20/{stationName}/',
      pathParams: { stationName: query },
      auth: seoulOpenApiAuth(),
      security: 'DOCUMENTED_HTTP_REQUIRES_VALIDATION',
    };
    return mapSeoulSubwayStations(await this.transport.getJson(request, context));
  }

  async arrivals(stationName: string, line?: string, context?: ProviderRequestContext) {
    const request: ProviderJsonRequest = {
      source: 'seoul-subway',
      capability: 'realtime-subway-arrivals',
      method: 'GET',
      urlTemplate: 'http://swopenAPI.seoul.go.kr/api/subway/{SEOUL_SUBWAY_API_KEY}/json/realtimeStationArrival/0/20/{stationName}',
      pathParams: { stationName },
      auth: seoulSubwayRealtimeAuth(),
      security: 'DOCUMENTED_HTTP_REQUIRES_VALIDATION',
    };
    return mapSeoulSubwayArrivals(await this.transport.getJson(request, context), line);
  }

  async trainPositions(line: string, context?: ProviderRequestContext) {
    const request: ProviderJsonRequest = {
      source: 'seoul-subway',
      capability: 'realtime-subway-position',
      method: 'GET',
      urlTemplate: 'http://swopenAPI.seoul.go.kr/api/subway/{SEOUL_SUBWAY_API_KEY}/json/realtimePosition/0/100/{line}',
      pathParams: { line },
      auth: seoulSubwayRealtimeAuth(),
      security: 'DOCUMENTED_HTTP_REQUIRES_VALIDATION',
    };
    return mapSeoulSubwayTrainPositions(await this.transport.getJson(request, context));
  }
}
