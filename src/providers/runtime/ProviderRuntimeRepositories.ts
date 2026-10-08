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
  TransitRouteResult,
} from '../../application/contracts/providers';
import { calculateArrivalEta } from '../../application/services/ArrivalEtaCalculator';
import type {
  CommuteRepository,
  PlaceRepository,
  PresenceRepository,
  ScheduleRepository,
  TodayRepository,
} from '../../application/contracts/repositories';

export interface RuntimeClock {
  now(): Date;
}

export const systemRuntimeClock: RuntimeClock = {
  now: () => new Date(),
};

function compareRoutes(left: RouteCandidate, right: RouteCandidate): number {
  return (
    (right.preferenceMatchScore ?? 0) - (left.preferenceMatchScore ?? 0) ||
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
    const originIds = activeSavedRoute
      ? activeSavedRoute.originAccessPointIds ??
        (activeSavedRoute.originAccessPointId ? [activeSavedRoute.originAccessPointId] : [])
      : [];
    const destinationIds = activeSavedRoute
      ? activeSavedRoute.destinationAccessPointIds ??
        (activeSavedRoute.destinationAccessPointId ? [activeSavedRoute.destinationAccessPointId] : [])
      : [];
    const viaIds = activeSavedRoute?.viaAccessPointIds ?? [];
    const originConfiguredPoints = originIds
      .map((id) => pointsById.get(id))
      .filter((point): point is TransitAccessPoint => point != null);
    const destinationConfiguredPoints = destinationIds
      .map((id) => pointsById.get(id))
      .filter((point): point is TransitAccessPoint => point != null);
    const viaConfiguredPoints = viaIds
      .map((id) => pointsById.get(id))
      .filter((point): point is TransitAccessPoint => point != null);

    const originSearchTargets = originConfiguredPoints
      .filter((point) => point.coordinate != null)
      .map((point) => ({ coordinate: point.coordinate!, fromSelectedAccess: true }));
    const destinationSearchTargets = destinationConfiguredPoints
      .filter((point) => point.coordinate != null)
      .map((point) => ({ coordinate: point.coordinate!, fromSelectedAccess: true }));

    const resolvedOriginTargets = originSearchTargets.length
      ? originSearchTargets
      : [{ coordinate: origin.coordinate, fromSelectedAccess: false }];
    const resolvedDestinationTargets = destinationSearchTargets.length
      ? destinationSearchTargets
      : [{ coordinate: destination.coordinate, fromSelectedAccess: false }];

    const searchPairs = resolvedOriginTargets.flatMap((originTarget) =>
      resolvedDestinationTargets.map((destinationTarget) => ({
        originTarget,
        destinationTarget,
      }))
    );

    try {
      const pairResults = await Promise.all(
        searchPairs.map(async ({ originTarget, destinationTarget }) => {
          try {
            const results = await this.routeProvider.search(
              originTarget.coordinate,
              destinationTarget.coordinate,
            );
            return results.map((result) => ({
              result,
              originFromSelectedAccess: originTarget.fromSelectedAccess,
              destinationFromSelectedAccess: destinationTarget.fromSelectedAccess,
            }));
          } catch {
            return [];
          }
        }),
      );

      const deduped = new Map<string, {
        result: TransitRouteResult;
        originFromSelectedAccess: boolean;
        destinationFromSelectedAccess: boolean;
      }>();

      for (const item of pairResults.flat()) {
        const existing = deduped.get(item.result.id);
        const itemEndpointScore =
          Number(item.originFromSelectedAccess) + Number(item.destinationFromSelectedAccess);
        const existingEndpointScore = existing
          ? Number(existing.originFromSelectedAccess) + Number(existing.destinationFromSelectedAccess)
          : -1;
        if (
          !existing ||
          itemEndpointScore > existingEndpointScore ||
          (
            itemEndpointScore === existingEndpointScore &&
            item.result.totalMinutes < existing.result.totalMinutes
          )
        ) {
          deduped.set(item.result.id, item);
        }
      }

      return [...deduped.values()]
        .map(({ result, originFromSelectedAccess, destinationFromSelectedAccess }): RouteCandidate => {
          const originConfigured = originConfiguredPoints.length > 0;
          const destinationConfigured = destinationConfiguredPoints.length > 0;
          const viaConfigured = viaConfiguredPoints.length > 0;
          const originMatch =
            !originConfigured ||
            originFromSelectedAccess ||
            originConfiguredPoints.some((point) => routeMatchesAccessPoint(result, point));
          const destinationMatch =
            !destinationConfigured ||
            destinationFromSelectedAccess ||
            destinationConfiguredPoints.some((point) => routeMatchesAccessPoint(result, point));
          const viaMatch =
            !viaConfigured ||
            viaConfiguredPoints.every((point) => routeMatchesAccessPoint(result, point));
          const configuredGroupCount =
            Number(originConfigured) + Number(destinationConfigured) + Number(viaConfigured);
          const matchedGroupCount =
            Number(originConfigured && originMatch) +
            Number(destinationConfigured && destinationMatch) +
            Number(viaConfigured && viaMatch);
          const preferenceMatchScore = configuredGroupCount
            ? matchedGroupCount / configuredGroupCount
            : 0;
          const matchesPreference =
            configuredGroupCount > 0 &&
            originMatch &&
            destinationMatch &&
            viaMatch;
          return {
            id: result.id,
            personId,
            totalMinutes: result.totalMinutes,
            transferCount: result.transferCount,
            walkMinutes: result.walkMinutes ?? 0,
            ...(result.accessMinutes == null ? {} : { accessMinutes: result.accessMinutes }),
            ...(result.egressMinutes == null ? {} : { egressMinutes: result.egressMinutes }),
            ...(result.fare == null ? {} : { fare: result.fare }),
            ...(result.steps ? { steps: result.steps } : {}),
            ...(preferenceMatchScore > 0 ? { preferenceMatchScore } : {}),
            ...(matchesPreference
              ? { matchesPreference: true, policyLabels: ['선택 교통 반영'] }
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
    private readonly presence: PresenceRepository,
    private readonly bus: RealtimeBusProvider,
    private readonly subway: RealtimeSubwayProvider,
    private readonly clock: RuntimeClock = systemRuntimeClock,
  ) {}

  async get(personId: EntityId): Promise<TodaySnapshot | null> {
    const now = this.clock.now();
    const date = kstDate(now);
    const [schedule, routes, preferredRouteCandidateId, originAccessPoints, savedRoutes, presence] = await Promise.all([
      this.schedules.getByDate(personId, date),
      this.commute.listRouteCandidates(personId),
      this.commute.getPreferredRouteCandidateId(personId),
      this.commute.listAccessPoints(personId, 'origin'),
      this.commute.listSavedRoutes(personId),
      this.presence.get(personId),
    ]);

    const currentPresence = presence?.workDate === date ? presence : null;

    // Never replace a user-selected route with another candidate silently.
    // When the preferred identity disappears after provider refresh, surface
    // UNKNOWN until the user chooses a valid route again.
    const route = preferredRouteCandidateId
      ? routes.find((candidate) => candidate.id === preferredRouteCandidateId) ?? null
      : routes.slice().sort(compareRoutes)[0] ?? null;

    const shiftEnd = schedule?.enabled ? schedule.end : undefined;
    const leftWorkAt = currentPresence?.leftWorkAt;
    const arrivedHomeAt = currentPresence?.arrivedHomeAt;

    if (arrivedHomeAt) {
      return {
        personId,
        eta: {
          personId,
          status: 'ACTUAL',
          arrivalTime: kstTime(new Date(arrivedHomeAt)),
          calculatedAt: now.toISOString(),
        },
        ...(shiftEnd ? { shiftEnd } : {}),
        ...(leftWorkAt ? { leftWorkAt } : {}),
        arrivedHomeAt,
        ...(route ? { routeCandidateId: route.id } : {}),
      };
    }

    if (!route) {
      return {
        personId,
        eta: {
          personId,
          status: 'UNKNOWN',
          calculatedAt: now.toISOString(),
        },
        ...(shiftEnd ? { shiftEnd } : {}),
        ...(leftWorkAt ? { leftWorkAt } : {}),
      };
    }

    const shiftEndTime = shiftEnd ? parseKstDateTime(date, shiftEnd) : null;
    const leftWorkTime = leftWorkAt ? Date.parse(leftWorkAt) : Number.NaN;
    const baselineDepartureMs = shiftEndTime ?? now.getTime();
    const departureMs = Number.isFinite(leftWorkTime)
      ? Math.max(baselineDepartureMs, leftWorkTime)
      : baselineDepartureMs;
     const activeSavedRoute = savedRoutes.find((savedRoute) => savedRoute.active) ?? savedRoutes[0];
    const activeOriginIds = activeSavedRoute
      ? activeSavedRoute.originAccessPointIds ??
        (activeSavedRoute.originAccessPointId ? [activeSavedRoute.originAccessPointId] : [])
      : [];
    const selectedAccess = activeOriginIds.length
      ? originAccessPoints.find((point) => activeOriginIds.includes(point.id))
      : originAccessPoints.find((point) => point.selected);
    let arrivals: Arrival[] = [];
    if (departureMs <= now.getTime()) {
      try {
        if (selectedAccess?.mode === 'BUS' && selectedAccess.selectedBusRouteId) {
          arrivals = await this.bus.arrivals(
            selectedAccess.providerId,
            selectedAccess.selectedBusRouteId,
          );
        } else if (selectedAccess?.mode === 'SUBWAY') {
          arrivals = await this.subway.arrivals(
            selectedAccess.providerId,
            selectedAccess.name,
            selectedAccess.line,
          );
        }
      } catch {
        arrivals = [];
      }
    }

    const calculated = calculateArrivalEta({
      departureMs,
      now,
      route,
      fallbackAccessMinutes: selectedAccess?.walkMinutes,
      arrivals,
    });
    const arrivalAt = calculated.arrivalAt;
    const status: EtaSnapshot['status'] = calculated.confidence;
    const freshness = calculated.freshnessMinutes;

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
      ...(leftWorkAt ? { leftWorkAt } : {}),
      routeCandidateId: route.id,
    };
  }
}
