import type { Coordinate } from '../domain/models';
import type { PlaceSearchProvider, PlaceSearchResult, TransitAccessSearchProvider, TransitSearchResult } from '../application/contracts/providers';

const placeResults: PlaceSearchResult[] = [
  { providerId: 'mock-place-result-1', placeName: '샘플 근무지', roadAddress: '서울특별시 강남구 샘플로 10', lotAddress: '서울특별시 강남구 샘플동 10', coordinate: { x: 127.01, y: 37.50 }, category: '업무시설' },
  { providerId: 'mock-place-result-2', placeName: '샘플 집', roadAddress: '서울특별시 관악구 샘플길 20', lotAddress: '서울특별시 관악구 샘플동 20', coordinate: { x: 126.93, y: 37.48 }, category: '주거' },
  { providerId: 'mock-place-result-3', placeName: '샘플 센터', roadAddress: '서울특별시 동작구 샘플로 30', coordinate: { x: 126.95, y: 37.49 }, category: '시설' },
];

const transitResults: TransitSearchResult[] = [
  {
    id: 'mock-transit-bus-b',
    providerId: 'mock-stop-b',
    mode: 'BUS',
    name: '샘플 정류장 B',
    displayCode: 'QA-1002',
    walkMinutes: 5,
    distanceM: 350,
    coordinate: { x: 127.005, y: 37.501 },
    routeCount: 2,
    busRoutes: [
      { providerRouteId: 'mock-bus-route-201', routeNo: 'QA-201', directionLabel: '샘플 중앙역 방면', terminalName: '샘플 종점 B', routeType: 'CITY_BUS' },
      { providerRouteId: 'mock-bus-route-202', routeNo: 'QA-202', directionLabel: '샘플 시청 방면', terminalName: '샘플 종점 C', routeType: 'CITY_BUS' },
    ],
  },
  { id: 'mock-transit-subway-b', providerId: 'mock-station-b', mode: 'SUBWAY', name: '샘플 도착역', line: '샘플선 B', walkMinutes: 4, distanceM: 280, coordinate: { x: 127.002, y: 37.499 } },
  { id: 'mock-transit-subway-c', providerId: 'mock-station-c', mode: 'SUBWAY', name: '샘플 중앙역', line: '샘플선 C', walkMinutes: 8, distanceM: 620, coordinate: { x: 127.009, y: 37.504 } },
];

function matches(value: string, query: string): boolean {
  return value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

export class MockPlaceSearchProvider implements PlaceSearchProvider {
  async search(query: string): Promise<PlaceSearchResult[]> {
    return structuredClone(placeResults.filter((result) =>
      matches([result.placeName, result.roadAddress, result.lotAddress, result.category].filter(Boolean).join(' '), query),
    ));
  }
}

export class MockTransitAccessSearchProvider implements TransitAccessSearchProvider {
  async search(query: string, _near: Coordinate): Promise<TransitSearchResult[]> {
    return structuredClone(transitResults.filter((result) =>
      matches([result.name, result.displayCode, result.line].filter(Boolean).join(' '), query),
    ));
  }
  async nearby(_near: Coordinate): Promise<TransitSearchResult[]> {
    return structuredClone(transitResults);
  }
}
