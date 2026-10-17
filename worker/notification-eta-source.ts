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

    const shiftEndMs = shiftTimes(schedule).end;
    if (!Number.isFinite(shiftEndMs)) {
      return { personId, arrivalAt: null, confidence: 'UNKNOWN' };
    }

    const actualDeparture = currentPresence?.leftWorkAt
      ? Date.parse(currentPresence.leftWorkAt)
      : Number.NaN;
    // Scheduled notifications must share Today's actual-departure rule.
    // An early LEFT_WORK is a real event, not a future scheduled departure.
    const departureMs = Number.isFinite(actualDeparture)
      ? actualDeparture
      : shiftEndMs;

    const originAccessPoints =
      await this.dependencies.commute.listAccessPoints(personId, 'origin');
    // Use only the verified access belonging to the ETA-selected provider
    // route. The first configured/selected stop may be a different bus line.
    const selectedAccess = route.realtimeOriginAccessPointId
      ? originAccessPoints.find(point => point.id === route.realtimeOriginAccessPointId)
      : undefined;

    let arrivals: Arrival[] = [];
    if (Number.isFinite(actualDeparture) && departureMs <= now.getTime()) {
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
