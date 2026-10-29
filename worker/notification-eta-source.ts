import { activeWorkSchedule, previousSeoulDate, shiftTimes } from '../src/domain/product-time';
import type {
  NotificationEtaSource,
  NotificationEtaState,
} from './contracts';
import type {
  CommuteRepository,
  PlaceRepository,
  PresenceRepository,
  ScheduleRepository,
} from '../src/application/contracts/repositories';
import { calculateArrivalEta } from '../src/application/services/ArrivalEtaCalculator';
import { ProviderCommuteRepository } from '../src/providers/runtime/ProviderRuntimeRepositories';
import type { Arrival } from '../src/application/contracts/providers';
import type { ProviderSourceBundle } from './providers/contracts';
import { D1CommuteRepository } from './repositories/D1CommuteRepository';
import { D1PlaceRepository } from './repositories/D1PlaceRepository';
import { D1PresenceRepository } from './repositories/D1PresenceRepository';
import { D1ScheduleRepository } from './repositories/D1ScheduleRepository';
import type { D1DatabaseLike } from './runtime-types';
import { D1NotificationRouteCache, NOTIFICATION_ROUTE_POLICY, nextSeoulDay, type NotificationRouteCache, type NotificationRouteSnapshot } from './notification-route-cache';

const PRODUCT_TIMEZONE = 'Asia/Seoul';

function seoulDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PRODUCT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + '-' + values.month + '-' + values.day;
}


export interface ProviderNotificationEtaDependencies {
  schedules: ScheduleRepository;
  places: PlaceRepository;
  presence: PresenceRepository;
  commute: CommuteRepository;
  providers: ProviderSourceBundle;
  routeCache: NotificationRouteCache;
}

export class ProviderNotificationEtaSource implements NotificationEtaSource {
  constructor(private readonly dependencies: ProviderNotificationEtaDependencies) {}

  async get(personId: string, now: Date): Promise<NotificationEtaState | null> {
    const date = seoulDate(now);
    const [schedules, presence] = await Promise.all([
      Promise.all([this.dependencies.schedules.getByDate(personId, date), this.dependencies.schedules.getByDate(personId, previousSeoulDate(now))]),
      this.dependencies.presence.get(personId),
    ]);

    const schedule = activeWorkSchedule(schedules.filter((entry): entry is NonNullable<typeof entry> => entry !== null), now);
    if (!schedule) return null;
    const currentPresence = presence?.workDate === schedule.date ? presence : null;
    if (currentPresence?.arrivedHomeAt) return null;

    const shiftEndMs = shiftTimes(schedule).end;
    if (!Number.isFinite(shiftEndMs)) return { personId, arrivalAt: null, confidence: 'UNKNOWN' };
    const actualDeparture = currentPresence?.leftWorkAt ? Date.parse(currentPresence.leftWorkAt) : Number.NaN;
    const departureMs = Number.isFinite(actualDeparture) ? actualDeparture : shiftEndMs;
    // The minute Cron keeps delivery/retries timely. It does not mean that
    // route discovery should run all workday. An explicit early departure
    // opens its own window; a scheduled time is never treated as LEFT_WORK.
    if (now.getTime() < departureMs - NOTIFICATION_ROUTE_POLICY.prepareBeforeEndMs) return null;

    let route: NotificationRouteSnapshot | null;
    try {
      route = await this.getRoute(personId, now, departureMs);
    } catch {
      // Missing migration, D1 outage or failed reservation must never fall
      // through to unmetered provider requests.
      return { personId, workDate: schedule.date, arrivalAt: null, confidence: 'UNKNOWN' };
    }
    if (!route) return { personId, workDate: schedule.date, arrivalAt: null, confidence: 'UNKNOWN' };

    const originAccessPoints =
      await this.dependencies.commute.listAccessPoints(personId, 'origin');
    // Use only the verified access belonging to the ETA-selected provider
    // route. The first configured/selected stop may be a different bus line.
    const selectedAccess = route.realtimeOriginAccessPointId
      ? originAccessPoints.find(point => point.id === route.realtimeOriginAccessPointId)
      : undefined;

    let arrivals: Arrival[] = [];
    if (Number.isFinite(actualDeparture) && departureMs <= now.getTime() &&
        now.getTime() <= departureMs + Math.max(0, route.accessMinutes ?? selectedAccess?.walkMinutes ?? 0) * 60_000) {
      try {
        if (selectedAccess?.mode === 'BUS' && selectedAccess.selectedBusRouteId) {
          arrivals = await this.dependencies.providers.seoulBus.arrivals(
            selectedAccess.providerId,
            selectedAccess.selectedBusRouteId,
            { fetchedAt: now.toISOString() },
          );
        } else if (selectedAccess?.mode === 'SUBWAY') {
          arrivals = await this.dependencies.providers.seoulSubway.arrivals(
            selectedAccess.name,
            selectedAccess.line,
            { fetchedAt: now.toISOString() },
          );
        }
      } catch {
        arrivals = [];
      }
    }

    const calculated = calculateArrivalEta({
      departureMs,
      departureBasis: Number.isFinite(actualDeparture) ? 'ACTUAL' : 'SCHEDULED',
      now,
      route,
      fallbackAccessMinutes: selectedAccess?.walkMinutes,
      arrivals,
    });

    return {
      personId,
      workDate: schedule.date,
      arrivalAt: calculated.arrivalAt.toISOString(),
      confidence: calculated.confidence,
      earliestArrivalAt: calculated.earliestArrivalAt.toISOString(),
      latestArrivalAt: calculated.latestArrivalAt.toISOString(),
      departureUnconfirmed: calculated.departureUnconfirmed,
      departureBasis: calculated.departureBasis,
    };
  }

  private async getRoute(personId: string, now: Date, departureMs: number): Promise<NotificationRouteSnapshot | null> {
    const { commute, places, routeCache } = this.dependencies;
    const [origin, destination, savedRoutes, originPoints, destinationPoints, preferredId, cached] = await Promise.all([
      places.get(personId, 'origin'), places.get(personId, 'destination'), commute.listSavedRoutes(personId),
      commute.listAccessPoints(personId, 'origin'), commute.listAccessPoints(personId, 'destination'),
      commute.getPreferredRouteCandidateId(personId), routeCache.get(personId),
    ]);
    // Recheck all route inputs even while a cached duration is valid. A shift
    // time change does not require a provider request: departure is recomputed
    // above on every tick. Route/location/access/preference changes do.
    const context = JSON.stringify({ origin, destination, savedRoutes, originPoints, destinationPoints, preferredId });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(context));
    const contextHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const matching = cached?.contextHash === contextHash ? cached : null;
    const horizon = Math.max(NOTIFICATION_ROUTE_POLICY.commuteWindowMs,
      ((matching?.route?.totalMinutes ?? 0) + 30) * 60_000);
    if (now.getTime() > departureMs + horizon) return null;
    if (matching?.route && Date.parse(matching.expiresAt) > now.getTime()) return matching.route;
    if (matching && Date.parse(matching.retryAfter) > now.getTime()) return null;

    const token = await routeCache.acquire(personId, contextHash, now);
    if (!token) return null; // Another tick owns the fenced refresh lease.
    let quotaBlocked = false;
    let route: NotificationRouteSnapshot | null = null;
    try {
      const runtimeCommute = new ProviderCommuteRepository(commute, places, {
        search: async (from, to) => {
          if (quotaBlocked || !await routeCache.reserveRequest(personId, token, now)) {
            quotaBlocked = true;
            throw new Error('Provider request failed: kakao-map/public-transit-routing HTTP 400 CODE -10');
          }
          try {
            return await this.dependencies.providers.kakao.publicTransitRoutes(from, to, { fetchedAt: now.toISOString() });
          } catch (error) {
            if (error instanceof Error && /HTTP 400 CODE -10/.test(error.message)) quotaBlocked = true;
            throw error;
          }
        },
      });
      const candidates = await runtimeCommute.listRouteCandidates(personId);
      const selected = preferredId ? candidates.find(candidate => candidate.id === preferredId) : candidates[0];
      // A selected route must never silently become another recommendation.
      if (selected && Number.isFinite(selected.totalMinutes) && selected.totalMinutes >= 0) {
        route = {
          id: selected.id, totalMinutes: selected.totalMinutes,
          ...(selected.accessMinutes != null ? { accessMinutes: selected.accessMinutes } : {}),
          ...(selected.egressMinutes != null ? { egressMinutes: selected.egressMinutes } : {}),
          ...(selected.realtimeOriginAccessPointId ? { realtimeOriginAccessPointId: selected.realtimeOriginAccessPointId } : {}),
        };
      }
    } finally {
      await routeCache.complete(personId, token, route, now,
        quotaBlocked ? nextSeoulDay(now) : new Date(now.getTime() + NOTIFICATION_ROUTE_POLICY.failureBackoffMs));
    }
    return route;
  }

}

export function createD1ProviderNotificationEtaSource(
  db: D1DatabaseLike,
  providers: ProviderSourceBundle,
): NotificationEtaSource {
  return new ProviderNotificationEtaSource({
    schedules: new D1ScheduleRepository(db),
    places: new D1PlaceRepository(db),
    presence: new D1PresenceRepository(db),
    commute: new D1CommuteRepository(db),
    providers,
    routeCache: new D1NotificationRouteCache(db),
  });
}
