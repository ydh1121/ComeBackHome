import type { Arrival } from '../contracts/providers';

export interface ArrivalEtaRoute {
  totalMinutes: number;
  accessMinutes?: number;
  egressMinutes?: number;
  /** Only set when the provider explicitly separates scheduled waiting time. */
  plannedWaitMinutes?: number;
}
export type CalculatedEtaConfidence = 'LIVE' | 'STALE' | 'FALLBACK';
export interface ArrivalEtaResult {
  arrivalAt: Date;
  earliestArrivalAt: Date;
  latestArrivalAt: Date;
  departureBasis: 'ACTUAL' | 'SCHEDULED';
  departureUnconfirmed: boolean;
  confidence: CalculatedEtaConfidence;
  freshnessMinutes?: number;
  realtimeArrival?: Arrival;
}
const LIVE_MAX_MINUTES = 2;
const STALE_MAX_MINUTES = 5;

export function calculateArrivalEta(input: {
  departureMs: number;
  now: Date;
  route: ArrivalEtaRoute;
  fallbackAccessMinutes?: number;
  arrivals?: Arrival[];
  departureBasis?: 'ACTUAL' | 'SCHEDULED';
  departureVariationMinutes?: 5 | 10;
}): ArrivalEtaResult {
  const basis = input.departureBasis ?? 'SCHEDULED';
  const total = Math.max(0, input.route.totalMinutes);
  const access = Math.max(0, input.route.accessMinutes ?? input.fallbackAccessMinutes ?? 0);
  const elapsed = Math.max(0, (input.now.getTime() - input.departureMs) / 60_000);
  // A stop countdown says nothing about a future scheduled departure or a
  // traveller who may already have boarded. Never imply location tracking.
  const observed = basis === 'ACTUAL' && elapsed <= access
    ? (input.arrivals ?? []).map(arrival => ({
        arrival,
        age: (input.now.getTime() - Date.parse(arrival.observedAt)) / 60_000,
      })).filter(({ arrival, age }) => Number.isFinite(age) && age >= 0 && age <= STALE_MAX_MINUTES &&
        Number.isFinite(arrival.minutes) && arrival.minutes - age >= Math.max(0, access - elapsed))
      .sort((a, b) => a.arrival.minutes - a.age - (b.arrival.minutes - b.age))[0]
    : undefined;
  const confidence = observed ? (observed.age <= LIVE_MAX_MINUTES ? 'LIVE' : 'STALE') : 'FALLBACK';
  let minutes = total;
  // The route total already includes walking and may include waiting. Replace
  // an explicitly known wait; otherwise retain that total, never add it twice.
  if (observed && input.route.plannedWaitMinutes !== undefined) {
    const actualWait = Math.max(0, elapsed + observed.arrival.minutes - observed.age - access);
    minutes = Math.max(0, total - Math.max(0, input.route.plannedWaitMinutes) + actualWait);
  }
  const arrivalMs = input.departureMs + minutes * 60_000;
  const variation = basis === 'SCHEDULED' ? (input.departureVariationMinutes ?? 10) : 0;
  const travelVariation = confidence === 'LIVE' ? 5 : 10;
  return {
    arrivalAt: new Date(arrivalMs),
    earliestArrivalAt: new Date(Math.max(input.departureMs - variation * 60_000, arrivalMs - (variation + travelVariation) * 60_000)),
    latestArrivalAt: new Date(arrivalMs + (variation + travelVariation) * 60_000),
    departureBasis: basis,
    departureUnconfirmed: basis === 'SCHEDULED' && input.now.getTime() > input.departureMs + variation * 60_000,
    confidence,
    ...(observed ? { freshnessMinutes: Math.floor(observed.age), realtimeArrival: observed.arrival } : {}),
  };
}
export const ARRIVAL_ETA_POLICY = { liveMaxMinutes: LIVE_MAX_MINUTES, staleMaxMinutes: STALE_MAX_MINUTES } as const;
