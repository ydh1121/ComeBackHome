import type { EntityId } from '../../domain/common';
import type {
  EtaSnapshot,
  PlaceKind,
  RouteCandidate,
  RoutePreference,
  SavedCommuteRoute,
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
    Number(right.matchesPreference === true) - Number(left.matchesPreference === true) ||
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

function normalizeTransitEvidence(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/정류장|정류소/g, '')
    .replace(/\s+/g, '');
}

function routeMatchesAccessPoint(
  route: import('../../application/contracts/providers').TransitRouteResult,
  point: TransitAccessPoint,
): boolean {
  if (point.mode === 'BUS' && point.selectedBusRouteId) {
    const routeIdMatch = (route.busLegs ?? []).some((leg) =>
      leg.routes.some((candidate) => candidate.providerRouteId === point.selectedBusRouteId)
    );
    if (routeIdMatch) return true;
  }

  const target = normalizeTransitEvidence(point.userLabel || point.name);
  if (!target) return false;

  const stopMatch = (route.busLegs ?? []).some((leg) =>
    leg.stopNames.some((name) => {
      const normalized = normalizeTransitEvidence(name);
      return normalized === target || normalized.includes(target) || target.includes(normalized);
    })
  );
  if (stopMatch) return true;

  return (route.steps ?? []).some((step) => {
    const normalized = normalizeTransitEvidence(step.label);
    return normalized.includes(target) || target.includes(normalized);
  });
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

  listSavedRoutes(personId: EntityId): Promise<SavedCommuteRoute[]> {
    return this.persisted.listSavedRoutes(personId);
  }

  createSavedRoute(personId: EntityId): Promise<SavedCommuteRoute> {
    return this.persisted.createSavedRoute(personId);
  }

  saveSavedRoute(route: SavedCommuteRoute): Promise<void> {
    return this.persisted.saveSavedRoute(route);
  }

  setActiveSavedRoute(personId: EntityId, routeId: EntityId): Promise<void> {
    return this.persisted.setActiveSavedRoute(personId, routeId);
  }

  async listRouteCandidates(personId: EntityId): Promise<RouteCandidate[]> {
    const [origin, destination, savedRoutes, originPoints, destinationPoints] = await Promise.all([
      this.places.get(personId, 'origin'),
      this.places.get(personId, 'destination'),
      this.persisted.listSavedRoutes(personId),
      this.persisted.listAccessPoints(personId, 'origin'),
      this.persisted.listAccessPoints(personId, 'destination'),
    ]);
    if (!origin?.coordinate || !destination?.coordinate) return [];

    const activeSavedRoute = savedRoutes.find((route) => route.active) ?? savedRoutes[0] ?? null;
    const pointsById = new Map(
      [...originPoints, ...destinationPoints].map((point) => [point.id, point]),
    );
    const configuredPointIds = activeSavedRoute
      ? [
          ...(activeSavedRoute.originAccessPointId ? [activeSavedRoute.originAccessPointId] : []),
          ...activeSavedRoute.viaAccessPointIds,
        ]
      : [];
    const configuredPoints = configuredPointIds
      .map((id) => pointsById.get(id))
      .filter((point): point is TransitAccessPoint => point != null);

    try {
      const results = await this.routeProvider.search(origin.coordinate, destination.coordinate);
      return results
        .map((result): RouteCandidate => {
          const matchesPreference =
            configuredPoints.length > 0 &&
            configuredPoints.every((point) => routeMatchesAccessPoint(result, point));
          return {
            id: result.id,
            personId,
            totalMinutes: result.totalMinutes,
            transferCount: result.transferCount,
            walkMinutes: result.walkMinutes ?? 0,
            ...(result.fare == null ? {} : { fare: result.fare }),
            ...(result.steps ? { steps: result.steps } : {}),
            ...(matchesPreference
              ? { matchesPreference: true, policyLabels: ['설정 경로'] }
              : {}),
          };
        })
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
    const [schedule, routes, preferredRouteCandidateId, originAccessPoints, savedRoutes] = await Promise.all([
      this.schedules.getByDate(personId, date),
      this.commute.listRouteCandidates(personId),
      this.commute.getPreferredRouteCandidateId(personId),
      this.commute.listAccessPoints(personId, 'origin'),
      this.commute.listSavedRoutes(personId),
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

    const activeSavedRoute = savedRoutes.find((savedRoute) => savedRoute.active) ?? savedRoutes[0];
    const selectedAccess = activeSavedRoute?.originAccessPointId
      ? originAccessPoints.find((point) => point.id === activeSavedRoute.originAccessPointId)
      : originAccessPoints.find((point) => point.selected);
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
