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

function parseSeoulDateTime(date: string, time: string): number | null {
  const value = Date.parse(date + 'T' + time + ':00+09:00');
  return Number.isFinite(value) ? value : null;
}

export interface ProviderNotificationEtaDependencies {
  schedules: ScheduleRepository;
  places: PlaceRepository;
  presence: PresenceRepository;
  commute: CommuteRepository;
  providers: ProviderSourceBundle;
}

export class ProviderNotificationEtaSource implements NotificationEtaSource {
  constructor(private readonly dependencies: ProviderNotificationEtaDependencies) {}

  async get(personId: string, now: Date): Promise<NotificationEtaState | null> {
    const date = seoulDate(now);
    const [schedule, presence] = await Promise.all([
      this.dependencies.schedules.getByDate(personId, date),
      this.dependencies.presence.get(personId),
    ]);

    if (!schedule?.enabled) return null;
    const currentPresence = presence?.workDate === date ? presence : null;
    if (currentPresence?.arrivedHomeAt) return null;

    const runtimeCommute = new ProviderCommuteRepository(
      this.dependencies.commute,
      this.dependencies.places,
      {
        search: (origin, destination) =>
          this.dependencies.providers.kakao.publicTransitRoutes(
            origin,
            destination,
            { fetchedAt: now.toISOString() },
          ),
      },
    );

    let routes;
    try {
      routes = await runtimeCommute.listRouteCandidates(personId);
    } catch {
      return { personId, arrivalAt: null, confidence: 'UNKNOWN' };
    }

    const preferredRouteCandidateId =
      await this.dependencies.commute.getPreferredRouteCandidateId(personId);
    // A saved route is authoritative. Provider refresh may make its ID
    // temporarily unavailable, but choosing another route would silently
    // change the user's ETA/notification plan. Match Today fail-closed semantics.
    const route = preferredRouteCandidateId
      ? routes.find((candidate) => candidate.id === preferredRouteCandidateId) ?? null
      : routes[0] ?? null;
    if (!route || !Number.isFinite(route.totalMinutes) || route.totalMinutes < 0) {
      return { personId, arrivalAt: null, confidence: 'UNKNOWN' };
    }

    const shiftEndMs = parseSeoulDateTime(schedule.date, schedule.end);
    if (shiftEndMs == null) {
      return { personId, arrivalAt: null, confidence: 'UNKNOWN' };
    }

    const actualDeparture = currentPresence?.leftWorkAt
      ? Date.parse(currentPresence.leftWorkAt)
      : Number.NaN;
    const departureMs = Number.isFinite(actualDeparture)
      ? Math.max(shiftEndMs, actualDeparture)
      : shiftEndMs;

    const [originAccessPoints, savedRoutes] = await Promise.all([
      this.dependencies.commute.listAccessPoints(personId, 'origin'),
      this.dependencies.commute.listSavedRoutes(personId),
    ]);
    const activeSavedRoute =
      savedRoutes.find((candidate) => candidate.active) ?? savedRoutes[0] ?? null;
    const selectedAccess = activeSavedRoute?.originAccessPointId
      ? originAccessPoints.find((point) => point.id === activeSavedRoute.originAccessPointId)
      : originAccessPoints.find((point) => point.selected);

    let arrivals: Arrival[] = [];
    if (departureMs <= now.getTime()) {
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
      now,
      route,
      fallbackAccessMinutes: selectedAccess?.walkMinutes,
      arrivals,
    });

    return {
      personId,
      arrivalAt: calculated.arrivalAt.toISOString(),
      confidence: calculated.confidence,
    };
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
  });
}
