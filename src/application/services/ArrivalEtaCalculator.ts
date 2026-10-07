import type { Arrival } from '../contracts/providers';

export interface ArrivalEtaRoute {
  totalMinutes: number;
  accessMinutes?: number;
  egressMinutes?: number;
}

export type CalculatedEtaConfidence = 'LIVE' | 'STALE' | 'FALLBACK';

export interface ArrivalEtaResult {
  arrivalAt: Date;
  confidence: CalculatedEtaConfidence;
  freshnessMinutes?: number;
  realtimeArrival?: Arrival;
}

const LIVE_MAX_MINUTES = 2;
const STALE_MAX_MINUTES = 5;

function ageMinutes(observedAt: string, now: Date): number | null {
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(observed)) return null;
  return Math.max(0, (now.getTime() - observed) / 60_000);
}

function usableArrival(
  arrivals: Arrival[],
  now: Date,
  minimumArrivalMinutes: number,
): Arrival | null {
  return arrivals
    .filter((arrival) => {
      const age = ageMinutes(arrival.observedAt, now);
      return (
        age != null &&
        age <= STALE_MAX_MINUTES &&
        Number.isFinite(arrival.minutes) &&
        arrival.minutes >= minimumArrivalMinutes
      );
    })
    .sort((left, right) =>
      left.minutes - right.minutes ||
      Date.parse(right.observedAt) - Date.parse(left.observedAt)
    )[0] ?? null;
}

export function calculateArrivalEta(input: {
  departureMs: number;
  now: Date;
  route: ArrivalEtaRoute;
  fallbackAccessMinutes?: number;
  arrivals?: Arrival[];
}): ArrivalEtaResult {
  const totalMinutes = Math.max(0, input.route.totalMinutes);
  const accessMinutes = Math.max(
    0,
    input.route.accessMinutes ?? input.fallbackAccessMinutes ?? 0,
  );
  const egressMinutes = Math.max(0, input.route.egressMinutes ?? 0);
  const observed = usableArrival(
    input.arrivals ?? [],
    input.now,
    accessMinutes,
  );

  if (!observed) {
    return {
      arrivalAt: new Date(input.departureMs + totalMinutes * 60_000),
      confidence: 'FALLBACK',
    };
  }

  const coreMinutes = Math.max(
    0,
    totalMinutes - accessMinutes - egressMinutes,
  );
  const travelMinutes = observed.minutes + coreMinutes + egressMinutes;
  const freshness = ageMinutes(observed.observedAt, input.now) ?? STALE_MAX_MINUTES;

  return {
    arrivalAt: new Date(input.departureMs + travelMinutes * 60_000),
    confidence: freshness <= LIVE_MAX_MINUTES ? 'LIVE' : 'STALE',
    freshnessMinutes: Math.floor(freshness),
    realtimeArrival: observed,
  };
}

export const ARRIVAL_ETA_POLICY = {
  liveMaxMinutes: LIVE_MAX_MINUTES,
  staleMaxMinutes: STALE_MAX_MINUTES,
} as const;
