import type {
  NotificationEtaSource,
  NotificationEtaState,
} from './contracts';
import type {
  CommuteRepository,
  PlaceRepository,
  ScheduleRepository,
} from '../src/application/contracts/repositories';
import type { TransitRouteResult } from '../src/application/contracts/providers';
import type { ProviderSourceBundle } from './providers/contracts';
import { D1CommuteRepository } from './repositories/D1CommuteRepository';
import { D1PlaceRepository } from './repositories/D1PlaceRepository';
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

function compareRoutes(left: TransitRouteResult, right: TransitRouteResult): number {
  return (
    left.totalMinutes - right.totalMinutes ||
    left.transferCount - right.transferCount ||
    (left.walkMinutes ?? 0) - (right.walkMinutes ?? 0) ||
    left.id.localeCompare(right.id)
  );
}

export interface ProviderNotificationEtaDependencies {
  schedules: ScheduleRepository;
  places: PlaceRepository;
  commute: CommuteRepository;
  providers: ProviderSourceBundle;
}

export class ProviderNotificationEtaSource implements NotificationEtaSource {
  constructor(private readonly dependencies: ProviderNotificationEtaDependencies) {}

  async get(personId: string, now: Date): Promise<NotificationEtaState | null> {
    const date = seoulDate(now);
    const [schedule, origin, destination, preferredRouteCandidateId] = await Promise.all([
      this.dependencies.schedules.getByDate(personId, date),
      this.dependencies.places.get(personId, 'origin'),
      this.dependencies.places.get(personId, 'destination'),
      this.dependencies.commute.getPreferredRouteCandidateId(personId),
    ]);

    if (!schedule?.enabled) return null;
    if (!origin?.coordinate || !destination?.coordinate) {
      return { personId, arrivalAt: null, confidence: 'UNKNOWN' };
    }

    let routes: TransitRouteResult[];
    try {
      routes = await this.dependencies.providers.kakao.publicTransitRoutes(
        origin.coordinate,
        destination.coordinate,
        { fetchedAt: now.toISOString() },
      );
    } catch {
      return { personId, arrivalAt: null, confidence: 'UNKNOWN' };
    }

    const route =
      routes.find((candidate) => candidate.id === preferredRouteCandidateId) ??
      routes.slice().sort(compareRoutes)[0] ??
      null;
    if (!route || !Number.isFinite(route.totalMinutes) || route.totalMinutes < 0) {
      return { personId, arrivalAt: null, confidence: 'UNKNOWN' };
    }

    const shiftEndMs = parseSeoulDateTime(schedule.date, schedule.end);
    if (shiftEndMs == null) {
      return { personId, arrivalAt: null, confidence: 'UNKNOWN' };
    }

    const departureMs = Math.max(now.getTime(), shiftEndMs);
    return {
      personId,
      arrivalAt: new Date(departureMs + route.totalMinutes * 60_000).toISOString(),
      confidence: 'FALLBACK',
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
    commute: new D1CommuteRepository(db),
    providers,
  });
}
