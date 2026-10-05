import type { EntityId } from '../../domain/common';
import type {
  EtaSnapshot,
  PlaceKind,
  RouteCandidate,
  RoutePreference,
  TodaySnapshot,
  TransitAccessPoint,
} from '../../domain/models';
import type {
  Arrival,
  RealtimeBusProvider,
  RealtimeSubwayProvider,
  TransitRouteProvider,
} from '../../application/contracts/providers';
import type {
  CommuteRepository,
  PlaceRepository,
  ScheduleRepository,
  TodayRepository,
} from '../../application/contracts/repositories';

export interface RuntimeClock {
  now(): Date;
}

export interface RealtimeFreshnessPolicy {
  classify(observedAt: string, now: Date): 'LIVE' | 'STALE';
}

export const systemRuntimeClock: RuntimeClock = {
  now: () => new Date(),
};

function compareRoutes(left: RouteCandidate, right: RouteCandidate): number {
  return (
    left.totalMinutes - right.totalMinutes ||
    left.transferCount - right.transferCount ||
    left.walkMinutes - right.walkMinutes ||
    left.id.localeCompare(right.id)
  );
}

function kstDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + '-' + values.month + '-' + values.day;
}

function kstTime(now: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

function parseKstDateTime(date: string, time: string): number | null {
  const value = Date.parse(date + 'T' + time + ':00+09:00');
  return Number.isFinite(value) ? value : null;
}

function latestObservedArrival(arrivals: Arrival[]): Arrival | null {
  return arrivals
    .filter((arrival) => Number.isFinite(Date.parse(arrival.observedAt)))
    .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))[0] ?? null;
}

function freshnessMinutes(observedAt: string, now: Date): number | undefined {
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(observed)) return undefined;
  return Math.max(0, Math.floor((now.getTime() - observed) / 60_000));
}

export class ProviderCommuteRepository implements CommuteRepository {
  constructor(
    private readonly persisted: CommuteRepository,
    private readonly places: PlaceRepository,
    private readonly routeProvider: TransitRouteProvider,
  ) {}

  listAccessPoints(personId: EntityId, kind: PlaceKind): Promise<TransitAccessPoint[]> {
    return this.persisted.listAccessPoints(personId, kind);
  }

  upsertAccessPoint(point: TransitAccessPoint): Promise<void> {
    return this.persisted.upsertAccessPoint(point);
  }

  setAccessPointSelected(accessPointId: EntityId, selected: boolean): Promise<void> {
    return this.persisted.setAccessPointSelected(accessPointId, selected);
  }

  setAccessPointAlias(accessPointId: EntityId, userLabel: string): Promise<void> {
    return this.persisted.setAccessPointAlias(accessPointId, userLabel);
  }

  setSelectedBusRoute(accessPointId: EntityId, providerRouteId: string): Promise<void> {
    return this.persisted.setSelectedBusRoute(accessPointId, providerRouteId);
  }

  getRoutePreference(personId: EntityId): Promise<RoutePreference | null> {
    return this.persisted.getRoutePreference(personId);
  }

  saveRoutePreference(preference: RoutePreference): Promise<void> {
    return this.persisted.saveRoutePreference(preference);
  }

  async listRouteCandidates(personId: EntityId): Promise<RouteCandidate[]> {
    const [origin, destination] = await Promise.all([
      this.places.get(personId, 'origin'),
      this.places.get(personId, 'destination'),
    ]);
    if (!origin?.coordinate || !destination?.coordinate) return [];

    try {
      const results = await this.routeProvider.search(origin.coordinate, destination.coordinate);
      return results
        .map((result): RouteCandidate => ({
          id: result.id,
          personId,
          totalMinutes: result.totalMinutes,
          transferCount: result.transferCount,
          walkMinutes: result.walkMinutes ?? 0,
          ...(result.fare == null ? {} : { fare: result.fare }),
          ...(result.steps ? { steps: result.steps } : {}),
        }))
        .sort(compareRoutes);
    } catch {
      return [];
    }
  }

  getPreferredRouteCandidateId(personId: EntityId): Promise<EntityId | null> {
    return this.persisted.getPreferredRouteCandidateId(personId);
  }

  setPreferredRouteCandidateId(personId: EntityId, routeCandidateId: EntityId): Promise<void> {
    return this.persisted.setPreferredRouteCandidateId(personId, routeCandidateId);
  }
}

export class ProviderTodayRepository implements TodayRepository {
  constructor(
    private readonly schedules: ScheduleRepository,
    private readonly commute: CommuteRepository,
    private readonly bus: RealtimeBusProvider,
    private readonly subway: RealtimeSubwayProvider,
    private readonly clock: RuntimeClock = systemRuntimeClock,
    private readonly freshnessPolicy?: RealtimeFreshnessPolicy,
  ) {}

  async get(personId: EntityId): Promise<TodaySnapshot | null> {
    const now = this.clock.now();
    const date = kstDate(now);
    const [schedule, routes, preferredRouteCandidateId, originAccessPoints] = await Promise.all([
      this.schedules.getByDate(personId, date),
      this.commute.listRouteCandidates(personId),
      this.commute.getPreferredRouteCandidateId(personId),
      this.commute.listAccessPoints(personId, 'origin'),
    ]);

    const route =
      routes.find((candidate) => candidate.id === preferredRouteCandidateId) ??
      routes.slice().sort(compareRoutes)[0] ??
      null;

    const shiftEnd = schedule?.enabled ? schedule.end : undefined;
    if (!route) {
      return {
        personId,
        eta: {
          personId,
          status: 'UNKNOWN',
          calculatedAt: now.toISOString(),
        },
        ...(shiftEnd ? { shiftEnd } : {}),
      };
    }

    const shiftEndTime = shiftEnd ? parseKstDateTime(date, shiftEnd) : null;
    const departureMs = shiftEndTime == null
      ? now.getTime()
      : Math.max(now.getTime(), shiftEndTime);
    const arrivalAt = new Date(departureMs + route.totalMinutes * 60_000);

    const selectedAccess = originAccessPoints.find((point) => point.selected);
    let arrivals: Arrival[] = [];
    try {
      if (selectedAccess?.mode === 'BUS' && selectedAccess.selectedBusRouteId) {
        arrivals = await this.bus.arrivals(
          selectedAccess.providerId,
          selectedAccess.selectedBusRouteId,
        );
      } else if (selectedAccess?.mode === 'SUBWAY') {
        arrivals = await this.subway.arrivals(
          selectedAccess.name,
          selectedAccess.line,
        );
      }
    } catch {
      arrivals = [];
    }

    const observed = latestObservedArrival(arrivals);
    const freshness = observed ? freshnessMinutes(observed.observedAt, now) : undefined;
    const status: EtaSnapshot['status'] =
      observed && this.freshnessPolicy
        ? this.freshnessPolicy.classify(observed.observedAt, now)
        : 'FALLBACK';

    return {
      personId,
      eta: {
        personId,
        status,
        arrivalTime: kstTime(arrivalAt),
        ...(freshness == null ? {} : { freshnessMinutes: freshness }),
        calculatedAt: now.toISOString(),
      },
      ...(shiftEnd ? { shiftEnd } : {}),
      routeCandidateId: route.id,
    };
  }
}
