import type {
  Arrival,
  PlaceSearchResult,
  TransitRouteResult,
  TransitSearchResult,
} from '../../src/application/contracts/providers';
import type { CommuteStep, CommuteStepType } from '../../src/domain/models';
import type { SubwayTrainPosition } from './contracts';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function asRecords(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.map(asRecord).filter((item): item is JsonRecord => item !== null);
  const single = asRecord(value);
  return single ? [single] : [];
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const parsed = numberValue(value);
  if (parsed == null || parsed < 0) return undefined;
  return Math.floor(parsed);
}

function secondsToMinutes(value: unknown): number | undefined {
  const seconds = numberValue(value);
  if (seconds == null || seconds < 0) return undefined;
  return Math.ceil(seconds / 60);
}

function nestedRecords(root: JsonRecord, path: string[]): JsonRecord[] {
  let cursor: unknown = root;
  for (const segment of path) {
    const record = asRecord(cursor);
    if (!record) return [];
    cursor = record[segment];
  }
  return asRecords(cursor);
}

function seoulTimestamp(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(raw);
  if (match) {
    return match.slice(1).join('').replace(
      /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,
      '$1-$2-$3T$4:$5:$6+09:00',
    );
  }
  return raw;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function routeStepType(value: unknown): CommuteStepType | null {
  if (value === 'WALKING') return 'WALKING';
  if (value === 'BUS') return 'BUS';
  if (value === 'SUBWAY') return 'SUBWAY';
  return null;
}

function routeStepLabel(properties: JsonRecord, type: CommuteStepType): string {
  const guidance = text(properties.guidance);
  if (guidance) return guidance;
  const vehicle = asRecords(properties.vehicles).map((item) => text(item.name)).find(Boolean);
  if (vehicle) return vehicle;
  return type === 'WALKING' ? '도보' : type === 'BUS' ? '버스' : '지하철';
}

export function mapKakaoPlaceSearch(payload: unknown): PlaceSearchResult[] {
  const root = asRecord(payload);
  if (!root) return [];

  return asRecords(root.documents).flatMap((item) => {
    const providerId = text(item.id);
    const x = numberValue(item.x);
    const y = numberValue(item.y);
    const lotAddress = text(item.address_name);
    const roadAddress = text(item.road_address_name) ?? lotAddress;
    if (!providerId || x == null || y == null || !roadAddress) return [];

    return [{
      providerId,
      ...(text(item.place_name) ? { placeName: text(item.place_name) } : {}),
      roadAddress,
      ...(lotAddress && lotAddress !== roadAddress ? { lotAddress } : {}),
      coordinate: { x, y },
      ...(text(item.category_name) ? { category: text(item.category_name) } : {}),
    }];
  });
}

export function mapKakaoPublicTransitRoutes(payload: unknown): TransitRouteResult[] {
  const root = asRecord(payload);
  if (!root || text(root.status) !== 'OK') return [];

  return asRecords(root.routes).flatMap((route) => {
    const properties = asRecord(route.properties);
    if (!properties) return [];

    const totalSeconds = numberValue(properties.totalTime);
    const transfers = nonNegativeInteger(properties.transfers);
    if (totalSeconds == null || totalSeconds < 0 || transfers == null) return [];

    const rawSteps = asRecords(route.steps);
    const steps: CommuteStep[] = [];
    let walkingSeconds = 0;

    const identitySteps = rawSteps.flatMap((step) => {
      const stepProperties = asRecord(step.properties);
      if (!stepProperties) return [];
      const type = routeStepType(stepProperties.type);
      if (!type) return [];

      const stepSeconds = numberValue(stepProperties.time) ?? 0;
      if (type === 'WALKING' && stepSeconds > 0) walkingSeconds += stepSeconds;

      const label = routeStepLabel(stepProperties, type);
      steps.push({ type, label });
      return [{
        type,
        label,
        time: Math.max(0, Math.round(stepSeconds)),
        vehicles: asRecords(stepProperties.vehicles)
          .map((vehicle) => text(vehicle.name))
          .filter((name): name is string => Boolean(name)),
      }];
    });

    const fareRecord = asRecord(properties.fare);
    const fare = nonNegativeInteger(fareRecord?.value);
    const totalMinutes = Math.ceil(totalSeconds / 60);
    const identity = JSON.stringify({
      type: text(properties.type) ?? '',
      totalSeconds: Math.round(totalSeconds),
      transfers,
      fare: fare ?? null,
      steps: identitySteps,
    });

    return [{
      id: 'kakao-route:' + fnv1a(identity),
      totalMinutes,
      transferCount: transfers,
      ...(walkingSeconds > 0 ? { walkMinutes: Math.ceil(walkingSeconds / 60) } : {}),
      ...(fare != null ? { fare } : {}),
      ...(steps.length ? { steps } : {}),
    }];
  });
}

export function mapSeoulBusStops(payload: unknown): TransitSearchResult[] {
  const root = asRecord(payload);
  if (!root) return [];
  const items = nestedRecords(root, ['msgBody', 'itemList']);

  return items.flatMap((item) => {
    const providerId = text(item.stId);
    const name = text(item.stNm);
    if (!providerId || !name) return [];

    const distanceM = numberValue(item.dist);
    return [{
      id: 'seoul-bus:' + providerId,
      providerId,
      mode: 'BUS' as const,
      name,
      ...(text(item.arsId) ? { displayCode: text(item.arsId) } : {}),
      ...(distanceM != null && distanceM >= 0 ? { distanceM } : {}),
    }];
  });
}

export function mapSeoulBusArrivals(
  payload: unknown,
  routeProviderId?: string,
  stopProviderId?: string,
): Arrival[] {
  const root = asRecord(payload);
  if (!root) return [];
  const items = nestedRecords(root, ['msgBody', 'itemList']);
  const arrivals: Array<Arrival & { seconds: number }> = [];

  for (const item of items) {
    const routeId = text(item.busRouteId);
    const stopId = text(item.stId);
    if (routeProviderId && routeId && routeId !== routeProviderId) continue;
    if (stopProviderId && stopId && stopId !== stopProviderId) continue;
    const observedAt = seoulTimestamp(item.mkTm);
    if (!observedAt) continue;

    for (const suffix of ['1', '2'] as const) {
      const seconds = numberValue(item['exps' + suffix]);
      if (seconds == null || seconds < 0) continue;
      arrivals.push({
        ...(text(item['plainNo' + suffix]) ? { providerVehicleId: text(item['plainNo' + suffix]) } : {}),
        minutes: Math.ceil(seconds / 60),
        observedAt,
        seconds,
      });
    }
  }

  return arrivals
    .sort((left, right) => left.seconds - right.seconds)
    .map(({ seconds: _seconds, ...arrival }) => arrival);
}

export function mapSeoulSubwayStations(payload: unknown): TransitSearchResult[] {
  const root = asRecord(payload);
  if (!root) return [];
  const service = asRecord(root.SearchInfoBySubwayNameService);
  if (!service) return [];

  return asRecords(service.row).flatMap((item) => {
    const providerId = text(item.STATION_CD);
    const name = text(item.STATION_NM);
    if (!providerId || !name) return [];

    return [{
      id: 'seoul-subway:' + providerId,
      providerId,
      mode: 'SUBWAY' as const,
      name,
      ...(text(item.FR_CODE) ? { displayCode: text(item.FR_CODE) } : {}),
      ...(text(item.LINE_NUM) ? { line: text(item.LINE_NUM) } : {}),
    }];
  });
}

export function mapSeoulSubwayArrivals(payload: unknown): Arrival[] {
  const root = asRecord(payload);
  if (!root) return [];

  return asRecords(root.realtimeArrivalList).flatMap((item) => {
    const minutes = secondsToMinutes(item.barvlDt);
    const observedAt = seoulTimestamp(item.recptnDt);
    if (minutes == null || !observedAt) return [];

    return [{
      ...(text(item.btrainNo) ? { providerVehicleId: text(item.btrainNo) } : {}),
      minutes,
      observedAt,
    }];
  });
}

export function mapSeoulSubwayTrainPositions(payload: unknown): SubwayTrainPosition[] {
  const root = asRecord(payload);
  if (!root) return [];

  return asRecords(root.realtimePositionList).flatMap((item) => {
    const providerTrainId = text(item.trainNo);
    const line = text(item.subwayNm) ?? text(item.subwayId);
    const stationName = text(item.statnNm);
    const observedAt = seoulTimestamp(item.recptnDt);
    if (!providerTrainId || !line || !stationName || !observedAt) return [];

    const updnLine = text(item.updnLine);
    const directAt = text(item.directAt);
    return [{
      providerTrainId,
      line,
      stationName,
      observedAt,
      ...(updnLine ? {
        direction: updnLine === '0' ? '상행/내선' : updnLine === '1' ? '하행/외선' : updnLine,
      } : {}),
      ...(text(item.statnTnm) ? { terminalName: text(item.statnTnm) } : {}),
      ...(text(item.trainSttus) ? { status: text(item.trainSttus) } : {}),
      ...(directAt ? { express: directAt === '1' || directAt === '7' } : {}),
    }];
  });
}
