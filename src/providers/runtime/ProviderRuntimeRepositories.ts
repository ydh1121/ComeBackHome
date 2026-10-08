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
  RouteDiscovery,
  RouteProviderErrorCategory,
  RouteSearchSource,
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

// Only numeric Korean WGS84 longitude/latitude pairs can be sent to the
// transit provider. Reject NaN, reversed axes and (0,0), without logging any
// person's address or location.
function validRouteCoordinate(value: { x: number; y: number } | undefined): value is { x: number; y: number } {
  return !!value && Number.isFinite(value.x) && Number.isFinite(value.y) &&
    value.x >= 124 && value.x <= 132 && value.y >= 33 && value.y <= 39;
}

function providerErrorCategory(error: unknown): RouteProviderErrorCategory {
  const message = error instanceof Error ? error.message : String(error);
  if (/unauthoriz|forbidden|invalid.api.key|authentication|permission|api key/i.test(message)) return 'AUTH';
  if (/HTTP|status|quota|limit has been exceeded|disabled|unavailable|not configured|activation blocked/i.test(message)) return 'HTTP';
  return 'UNKNOWN';
}

type RouteTarget = {
  coordinate: { x: number; y: number };
  source: RouteSearchSource;
};
type FoundRoute = {
  result: TransitRouteResult;
  originSource: RouteSearchSource;
  destinationSource: RouteSearchSource;
};

function accessPriority(origin: RouteSearchSource, destination: RouteSearchSource): number {
  if (origin === 'ROUTE_ACCESS' && destination === 'ROUTE_ACCESS') return 1;
  if (origin !== 'PLACE' && destination !== 'PLACE') return 0.95;
  if (origin !== 'PLACE' || destination !== 'PLACE') return 0.5;
  return 0;
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
    return (await this.inspectRouteCandidates(personId)).candidates;
  }

  async inspectRouteCandidates(personId: EntityId): Promise<RouteDiscovery> {
    const [origin, destination, savedRoutes, originPoints, destinationPoints] = await Promise.all([
      this.places.get(personId, 'origin'),
      this.places.get(personId, 'destination'),
      this.persisted.listSavedRoutes(personId),
      this.persisted.listAccessPoints(personId, 'origin'),
      this.persisted.listAccessPoints(personId, 'destination'),
    ]);
    const activeSavedRoute = savedRoutes.find((route) => route.active) ?? savedRoutes[0] ?? null;
    const originIds = activeSavedRoute
      ? activeSavedRoute.originAccessPointIds ??
        (activeSavedRoute.originAccessPointId ? [activeSavedRoute.originAccessPointId] : [])
      : [];
    const destinationIds = activeSavedRoute
      ? activeSavedRoute.destinationAccessPointIds ??
        (activeSavedRoute.destinationAccessPointId ? [activeSavedRoute.destinationAccessPointId] : [])
      : [];
    const originById = new Map(originPoints.map((point) => [point.id, point]));
    const destinationById = new Map(destinationPoints.map((point) => [point.id, point]));
    const routeOrigin = originIds.map((id) => originById.get(id))
      .filter((point): point is TransitAccessPoint => !!point);
    const routeDestination = destinationIds.map((id) => destinationById.get(id))
      .filter((point): point is TransitAccessPoint => !!point);
    const selectedOrigin = originPoints.filter((point) => point.selected);
    const selectedDestination = destinationPoints.filter((point) => point.selected);
    const staleAccessIdCount =
      originIds.length - routeOrigin.length + destinationIds.length - routeDestination.length;

    // Diagnostics deliberately contain counts and source classes only: no
    // person names, private coordinates, stop IDs or provider credentials.
    const diagnostics: RouteDiscovery['diagnostics'] = {
      status: 'NO_RESULT',
      originPlaceCoordinatePresent: !!origin?.coordinate,
      destinationPlaceCoordinatePresent: !!destination?.coordinate,
      selectedOriginCount: selectedOrigin.length,
      selectedDestinationCount: selectedDestination.length,
      routeSpecificOriginCount: routeOrigin.length,
      routeSpecificDestinationCount: routeDestination.length,
      staleAccessIdCount,
      searchPairCount: 0,
      successfulPairCount: 0,
      failedPairCount: 0,
      totalRouteResultCount: 0,
      dedupedCandidateCount: 0,
      placeFallbackUsed: false,
      pairs: [],
    };
    if (!origin?.coordinate || !destination?.coordinate) {
      diagnostics.status = 'MISSING_PLACE';
      return { candidates: [], diagnostics };
    }
    if (!validRouteCoordinate(origin.coordinate) || !validRouteCoordinate(destination.coordinate)) {
      diagnostics.status = 'INVALID_COORDINATE';
      return { candidates: [], diagnostics };
    }

    const toTargets = (points: TransitAccessPoint[], source: RouteSearchSource): RouteTarget[] =>
      points.filter((point) => validRouteCoordinate(point.coordinate))
        .map((point) => ({ coordinate: point.coordinate!, source }));
    const originRouteTargets = toTargets(routeOrigin, 'ROUTE_ACCESS');
    const destinationRouteTargets = toTargets(routeDestination, 'ROUTE_ACCESS');
    const originSelectedTargets = toTargets(selectedOrigin, 'SELECTED_ACCESS');
    const destinationSelectedTargets = toTargets(selectedDestination, 'SELECTED_ACCESS');
    const placeOrigin: RouteTarget = { coordinate: origin.coordinate, source: 'PLACE' };
    const placeDestination: RouteTarget = { coordinate: destination.coordinate, source: 'PLACE' };

    // A stale, opposite-side or invalid route-specific ID does not disable
    // the valid standalone selection. Each side resolves independently.
    const origins = originRouteTargets.length ? originRouteTargets :
      originSelectedTargets.length ? originSelectedTargets : [placeOrigin];
    const destinations = destinationRouteTargets.length ? destinationRouteTargets :
      destinationSelectedTargets.length ? destinationSelectedTargets : [placeDestination];

    let hadProviderError = false;
    let runtimeDisabled = false;
    let hasPositiveSelectedPair = false;
    const found: FoundRoute[] = [];
    const search = async (originTarget: RouteTarget, destinationTarget: RouteTarget): Promise<void> => {
      const pair: RouteDiscovery['diagnostics']['pairs'][number] = {
        originSource: originTarget.source,
        destinationSource: destinationTarget.source,
        providerResultCount: 0,
        errorCategory: 'NONE',
      };
      diagnostics.pairs.push(pair);
      diagnostics.searchPairCount++;
      try {
        const results = await this.routeProvider.search(originTarget.coordinate, destinationTarget.coordinate);
        pair.providerResultCount = results.length;
        if (!results.length) {
          pair.errorCategory = 'NO_RESULT';
          return;
        }
        diagnostics.successfulPairCount++;
        diagnostics.totalRouteResultCount += results.length;
        if (originTarget.source !== 'PLACE' || destinationTarget.source !== 'PLACE') {
          hasPositiveSelectedPair = true;
        }
        for (const result of results) {
          found.push({
            result,
            originSource: originTarget.source,
            destinationSource: destinationTarget.source,
          });
        }
      } catch (error) {
        hadProviderError = true;
        diagnostics.failedPairCount++;
        pair.errorCategory = providerErrorCategory(error);
        if (error instanceof Error && /runtime is disabled|runtime is unavailable/i.test(error.message)) {
          runtimeDisabled = true;
        }
      }
    };

    await Promise.all(origins.flatMap((originTarget) =>
      destinations.map((destinationTarget) => search(originTarget, destinationTarget))));

    // Selected-pair discovery cannot suppress the original place-to-place
    // recommendation. Preserve any successful selected pairs; query bare
    // places only when the selected search yielded no usable routes.
    const selectedSearch = origins.some((item) => item.source !== 'PLACE') ||
      destinations.some((item) => item.source !== 'PLACE');
    if (selectedSearch && !hasPositiveSelectedPair) {
      diagnostics.placeFallbackUsed = true;
      await search(placeOrigin, placeDestination);
    }

    const deduped = new Map<string, FoundRoute>();
    for (const item of found) {
      const existing = deduped.get(item.result.id);
      if (!existing ||
        accessPriority(item.originSource, item.destinationSource) >
          accessPriority(existing.originSource, existing.destinationSource) ||
        (accessPriority(item.originSource, item.destinationSource) ===
          accessPriority(existing.originSource, existing.destinationSource) &&
          item.result.totalMinutes < existing.result.totalMinutes)) {
        deduped.set(item.result.id, item);
      }
    }

    const viaIds = activeSavedRoute?.viaAccessPointIds ?? [];
    const allPoints = [...originPoints, ...destinationPoints];
    const viaPoints = viaIds.map((id) => allPoints.find((point) => point.id === id))
      .filter((point): point is TransitAccessPoint => !!point);
    const candidates = [...deduped.values()].map((item): RouteCandidate => {
      const matchScore = accessPriority(item.originSource, item.destinationSource);
      const viaMatch = !viaPoints.length || viaPoints.every((point) => routeMatchesAccessPoint(item.result, point));
      const matchesPreference = matchScore >= 0.95 && viaMatch;
      return {
        id: item.result.id,
        personId,
        totalMinutes: item.result.totalMinutes,
        transferCount: item.result.transferCount,
        walkMinutes: item.result.walkMinutes ?? 0,
        ...(item.result.accessMinutes == null ? {} : { accessMinutes: item.result.accessMinutes }),
        ...(item.result.egressMinutes == null ? {} : { egressMinutes: item.result.egressMinutes }),
        ...(item.result.fare == null ? {} : { fare: item.result.fare }),
        ...(item.result.steps ? { steps: item.result.steps } : {}),
        ...(matchScore > 0 ? { preferenceMatchScore: matchScore } : {}),
        ...(matchesPreference ? { matchesPreference: true, policyLabels: ['선택 교통 반영'] } : {}),
      };
    }).sort(compareRoutes);
    diagnostics.dedupedCandidateCount = candidates.length;
    diagnostics.status = candidates.length ? 'OK' :
      runtimeDisabled ? 'RUNTIME_DISABLED' : hadProviderError ? 'PROVIDER_ERROR' : 'NO_RESULT';
    return { candidates, diagnostics };
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

    // A persisted preferred route must never silently turn into another
    // route when the provider refresh changes candidate IDs. Report UNKNOWN
    // until that exact stable route can be resolved again.
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
