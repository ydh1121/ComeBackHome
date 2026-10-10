import { BUILD_COMMIT_SHA } from './build-revision';
import type { Coordinate, PlaceKind, RoutePreference, SavedCommuteRoute, TransitAccessPoint, WebPushSubscriptionRecord } from '../src/domain/models';
import type { PlaceSearchResult, TransitSearchResult } from '../src/application/contracts/providers';
import { D1CommuteRepository } from './repositories/D1CommuteRepository';
import { D1NotificationJobStore } from './repositories/D1NotificationJobStore';
import { D1NotificationSettingsStore } from './repositories/D1NotificationSettingsStore';
import { D1PersonRepository } from './repositories/D1PersonRepository';
import { D1PlaceRepository } from './repositories/D1PlaceRepository';
import { D1PresenceRepository } from './repositories/D1PresenceRepository';
import { D1ScheduleRepository } from './repositories/D1ScheduleRepository';
import { D1SubscriptionStore } from './repositories/D1SubscriptionStore';
import type { WorkerEnv } from './runtime-types';
import type { ProviderSourceBundle } from './providers/contracts';
import {
  enqueuePresenceEvent,
  isPresenceEventAuthorized,
  type PresenceEventType,
} from './presence-event-ingest';
import { createNotificationActivationReadiness } from './notification-activation-readiness';
import { createPushDeliveryRuntime, inspectPushDeliveryConfig } from './push-delivery-readiness';
import { verifyVapidKeyPair } from './vapid-pair-validation';
import { PushDeliveryError } from './contracts';
import { classifyPushProviderFailure, pushSubscriptionKeyShapeValid } from './push/WebPushDeliveryGateway';
import { processNotificationOutbox, runScheduledNotificationCycle } from './scheduler';

type JsonObject = Record<string, unknown>;

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readObject(request: Request): Promise<JsonObject> {
  const body = await request.json();
  if (!isObject(body)) throw new Error('JSON object body is required.');
  return body;
}

function asString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(name + ' is required.');
  return value.trim();
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(name + ' must be boolean.');
  return value;
}

function optionalScheduleBreakMinutes(object: JsonObject): number | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(object, 'breakMinutes')) return undefined;
  const value = object.breakMinutes;
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) ||
      value < 0 || value > 720) throw new Error('INVALID_BREAK_MINUTES');
  return value;
}

function asPlaceKind(value: string): PlaceKind {
  if (value !== 'origin' && value !== 'destination') throw new Error('Invalid place kind.');
  return value;
}

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : 'Unexpected API error.';
  return json({ error: message }, 400);
}

// Absolute temporary quota cooldown. Only the canonical user-facing origin
// is blocked; local fixture contract tests never dispatch real provider calls.
// Expiry is an earliest allowed smoke time, NOT proof of quota reset.
const KAKAO_ROUTE_FREEZE_UNTIL = Date.parse('2026-10-09T00:05:00+09:00');
export function isKakaoRouteCooldownActive(epochMs: number): boolean {
  return epochMs < KAKAO_ROUTE_FREEZE_UNTIL;
}

function coordinateDistanceMeters(left: Coordinate, right: Coordinate): number {
  const earthRadius = 6_371_000;
  const toRadians = (value: number) => value * Math.PI / 180;
  const lat1 = toRadians(left.y);
  const lat2 = toRadians(right.y);
  const deltaLat = toRadians(right.y - left.y);
  const deltaLng = toRadians(right.x - left.x);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return Math.round(earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function placeToTransit(
  place: PlaceSearchResult,
  near: Coordinate,
  forcedMode?: 'BUS' | 'SUBWAY',
): TransitSearchResult {
  const descriptor = [place.placeName, place.category].filter(Boolean).join(' ');
  const mode =
    forcedMode ??
    (/지하철|전철|역(?:\s|$)/.test(descriptor) ? 'SUBWAY' : 'BUS');
  const distanceM = coordinateDistanceMeters(near, place.coordinate);
  return {
    id: 'kakao-transit:' + mode.toLowerCase() + ':' + place.providerId,
    providerId: place.providerId,
    mode,
    name: place.placeName ?? place.roadAddress,
    coordinate: place.coordinate,
    distanceM,
    walkMinutes: Math.max(1, Math.ceil(distanceM / 75)),
  };
}

function dedupeTransit(results: TransitSearchResult[]): TransitSearchResult[] {
  const seen = new Set<string>();
  return results
    .filter((item) => {
      const key = item.mode + ':' + item.providerId;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => (left.distanceM ?? Number.MAX_SAFE_INTEGER) - (right.distanceM ?? Number.MAX_SAFE_INTEGER));
}

function trimNearbyTransitByDistance(results: TransitSearchResult[]): TransitSearchResult[] {
  const sorted = dedupeTransit(results);
  const kept: TransitSearchResult[] = [];

  for (const mode of ['BUS', 'SUBWAY'] as const) {
    const group = sorted.filter((item) => item.mode === mode && item.distanceM != null);
    if (!group.length) continue;
    const nearest = group[0].distanceM ?? 0;
    // Subway candidates should stay tighter than generic place search.
    // When a station is already close, avoid leaking adjacent districts/stations.
    const baseRadius = mode === 'BUS' ? 450 : 450;
    const delta = mode === 'BUS' ? 450 : 250;
    const normalCap = mode === 'BUS' ? 800 : 900;
    // Do not expand the local search just because the nearest hit is 9 km away.
    if (nearest > normalCap) continue;
    const threshold = Math.min(normalCap, Math.max(baseRadius, nearest + delta));
    kept.push(...group.filter((item) => (item.distanceM ?? Number.MAX_SAFE_INTEGER) <= threshold));
  }

  return kept
    .sort((left, right) =>
      (left.distanceM ?? Number.MAX_SAFE_INTEGER) -
      (right.distanceM ?? Number.MAX_SAFE_INTEGER)
    )
    .slice(0, 24);
}

function normalizeTransitName(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\s+/g, '')
    .replace(/정류장|정류소|역$/g, '');
}

function chooseTransitResolution(
  candidates: TransitSearchResult[],
  name: string,
  near: Coordinate,
  line?: string,
): TransitSearchResult | null {
  const target = normalizeTransitName(name);
  const targetLine = line?.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase() ?? '';
  const scored = candidates.map((candidate) => {
    const candidateName = normalizeTransitName(candidate.name);
    const nameScore =
      candidateName === target ? 0 :
      candidateName.includes(target) || target.includes(candidateName) ? 1 :
      3;
    const lineValue = candidate.line?.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase() ?? '';
    const lineScore = targetLine && lineValue
      ? lineValue === targetLine || lineValue.includes(targetLine) || targetLine.includes(lineValue) ? 0 : 1
      : 0;
    const distance = candidate.coordinate
      ? coordinateDistanceMeters(near, candidate.coordinate)
      : candidate.distanceM ?? 99_999;
    return { candidate, score: nameScore * 1_000_000 + lineScore * 100_000 + distance };
  }).sort((left, right) => left.score - right.score);

  const best = scored[0];
  return best && best.score < 3_000_000 ? best.candidate : null;
}

export async function handleApiRequest(
  request: Request,
  env: WorkerEnv,
  providerRuntime: ProviderSourceBundle | null = null,
): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0] !== 'api') return json({ error: 'Not found.' }, 404);

  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  if (isMutation && env.MUTATIONS_ENABLED === '0') {
    return json({ error: 'API mutations are temporarily disabled.' }, 503);
  }

  try {
    if (
      segments.length === 3 &&
      segments[1] === 'internal' &&
      segments[2] === 'scheduler-tick' &&
      request.method === 'POST'
    ) {
      const configuredToken = env.PRESENCE_EVENT_INGEST_TOKEN?.trim();
      if (!configuredToken) return json({ error: 'Scheduler invocation is not configured.' }, 503);
      if (request.headers.get('Authorization') !== 'Bearer ' + configuredToken) return json({ error: 'Unauthorized.' }, 401);
      const body = await readObject(request);
      const scheduledTime = Number(body.scheduledTime);
      if (!Number.isFinite(scheduledTime) || scheduledTime <= 0) return json({ error: 'scheduledTime is invalid.' }, 400);
      const readiness = createNotificationActivationReadiness(env, providerRuntime);
      if (!readiness.ready) return json({ error: 'Scheduled notification runtime is not ready.', missing: readiness.missing }, 503);
      const result = await runScheduledNotificationCycle(env, scheduledTime, readiness.dependencies);
      return json({ result });
    }

    if (segments.length === 2 && segments[1] === 'health' && request.method === 'GET') {
      const row = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
      return json({ ok: row?.ok === 1, version: BUILD_COMMIT_SHA === 'unknown' ? 'unknown' : BUILD_COMMIT_SHA.slice(0, 12), commitSha: BUILD_COMMIT_SHA });
    }

    if (segments.length === 2 && segments[1] === 'client-config' && request.method === 'GET') {
      const kakaoMapsJavaScriptKey =
        env.CBH_KAKAO_MAPS_JAVASCRIPT_KEY?.trim() ||
        env.VITE_CBH_KAKAO_JAVASCRIPT_KEY?.trim() ||
        env.KAKAO_JAVASCRIPT_KEY?.trim() ||
        '';
      return json({
        kakaoMaps: {
          configured: Boolean(kakaoMapsJavaScriptKey),
          javaScriptKey: kakaoMapsJavaScriptKey,
        },
      });
    }

    if (segments[1] === 'providers' && request.method === 'GET') {
      const enabled = env.PROVIDER_RUNTIME_ENABLED === '1';

      if (segments.length === 3 && segments[2] === 'status') {
        return json({
          enabled,
          source: providerRuntime ? 'worker-provider' : enabled ? 'unavailable' : 'unconfigured',
          capabilities: {
            kakao: Boolean(env.KAKAO_REST_API_KEY?.trim()),
            seoulBus: Boolean(env.SEOUL_BUS_SERVICE_KEY?.trim()),
            seoulSubwayStationSearch: Boolean(env.SEOUL_OPENAPI_KEY?.trim()),
            seoulSubwayRealtime: Boolean(env.SEOUL_SUBWAY_API_KEY?.trim()),
            seoulSubway: Boolean(
              env.SEOUL_OPENAPI_KEY?.trim() &&
              env.SEOUL_SUBWAY_API_KEY?.trim()
            ),
          },
        });
      }

      if (
        segments.length === 3 &&
        (
          segments[2] === 'place-search' ||
          segments[2] === 'transit-search' ||
          segments[2] === 'transit-nearby' ||
          segments[2] === 'transit-resolve' ||
          segments[2] === 'static-map' ||
          segments[2] === 'routes' ||
          segments[2] === 'bus-routes' ||
          segments[2] === 'bus-arrivals' ||
          segments[2] === 'subway-arrivals'
        )
      ) {
        if (!enabled || !providerRuntime) {
          return json({ error: 'Provider runtime is disabled.' }, 503);
        }

        try {
          if (segments[2] === 'transit-resolve') {
            const mode = url.searchParams.get('mode');
            const name = url.searchParams.get('name')?.trim() ?? '';
            const line = url.searchParams.get('line')?.trim() || undefined;
            const x = Number(url.searchParams.get('x'));
            const y = Number(url.searchParams.get('y'));
            if ((mode !== 'BUS' && mode !== 'SUBWAY') || !name || ![x, y].every(Number.isFinite)) {
              return json({ error: 'mode/name/x/y are required.' }, 400);
            }
            const near = { x, y };

            if (mode === 'BUS') {
              let candidates: TransitSearchResult[] = [];
              try {
                candidates = await providerRuntime.seoulBus.searchStops(name, near);
              } catch {
                candidates = [];
              }
              const stop = chooseTransitResolution(candidates, name, near);
              if (!stop) return json({ resolved: {} });

              let busRoutes = stop.busRoutes ?? [];
              if (stop.displayCode) {
                try {
                  busRoutes = await providerRuntime.seoulBus.routesByStop(stop.displayCode);
                } catch {
                  busRoutes = [];
                }
              }
              return json({
                resolved: {
                  ...stop,
                  ...(busRoutes.length ? {
                    busRoutes,
                    routeCount: busRoutes.length,
                  } : {}),
                },
              });
            }

            let stations: TransitSearchResult[] = [];
            try {
              stations = await providerRuntime.seoulSubway.searchStations(name, near);
            } catch {
              stations = [];
            }
            const station = chooseTransitResolution(stations, name, near, line);
            return json({ resolved: station ?? {} });
          }

          if (segments[2] === 'bus-routes') {
            const arsId = url.searchParams.get('arsId')?.trim() ?? '';
            if (!/^\d{4,5}$/.test(arsId)) {
              return json({ error: 'Valid arsId is required.' }, 400);
            }
            return json({
              routes: await providerRuntime.seoulBus.routesByStop(arsId.padStart(5, '0')),
            });
          }

          if (segments[2] === 'bus-arrivals') {
            const stopProviderId = url.searchParams.get('stopProviderId')?.trim() ?? '';
            const routeProviderId = url.searchParams.get('routeProviderId')?.trim() ?? '';
            if (!stopProviderId || !routeProviderId) {
              return json({ error: 'stopProviderId/routeProviderId are required.' }, 400);
            }
            if (!/^\d+$/.test(stopProviderId) || !/^\d+$/.test(routeProviderId)) {
              return json({ arrivals: [] });
            }
            return json({
              arrivals: await providerRuntime.seoulBus.arrivals(stopProviderId, routeProviderId),
            });
          }

          if (segments[2] === 'subway-arrivals') {
            const providerStationId = url.searchParams.get('providerStationId')?.trim() ?? '';
            const stationName = url.searchParams.get('stationName')?.trim() ?? '';
            const line = url.searchParams.get('line')?.trim() || undefined;
            if (!providerStationId || !stationName) {
              return json({ error: 'providerStationId/stationName are required.' }, 400);
            }

            let stations: TransitSearchResult[] = [];
            try {
              stations = await providerRuntime.seoulSubway.searchStations(stationName);
            } catch {
              stations = [];
            }
            const station = stations.find((candidate) => candidate.providerId === providerStationId);
            if (!station) {
              return json({ providerStationId, arrivals: [] });
            }

            return json({
              providerStationId,
              arrivals: await providerRuntime.seoulSubway.arrivals(
                station.name,
                line ?? station.line,
              ),
            });
          }

          if (segments[2] === 'static-map') {
            const centerX = Number(url.searchParams.get('centerX'));
            const centerY = Number(url.searchParams.get('centerY'));
            if (![centerX, centerY].every(Number.isFinite)) {
              return json({ error: 'centerX/centerY are required.' }, 400);
            }

            const markers = url.searchParams.getAll('marker').slice(0, 4).flatMap((marker) => {
              const [xRaw, yRaw] = marker.split(',');
              const x = Number(xRaw);
              const y = Number(yRaw);
              return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : [];
            });
            const image = await providerRuntime.kakao.staticMap({ x: centerX, y: centerY }, markers);
            return new Response(image.body, {
              status: 200,
              headers: {
                'Content-Type': image.contentType,
                'Cache-Control': 'no-store',
              },
            });
          }

          if (segments[2] === 'place-search') {
            const query = url.searchParams.get('q')?.trim();
            if (!query) return json({ error: 'q is required.' }, 400);

            const x = Number(url.searchParams.get('x'));
            const y = Number(url.searchParams.get('y'));
            const near = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
            return json({ results: await providerRuntime.kakao.searchPlaces(query, near) });
          }

          if (segments[2] === 'transit-nearby') {
            const x = Number(url.searchParams.get('x'));
            const y = Number(url.searchParams.get('y'));
            if (![x, y].every(Number.isFinite)) {
              return json({ error: 'x/y are required.' }, 400);
            }
            const near = { x, y };
            // Official stop IDs/ARS are authoritative. If Seoul's positional
            // endpoint is empty or unavailable, only transport-category Kakao
            // bus points inside the same absolute radius may be offered.
            const [officialResult, busPlaces, subwayPlaces] = await Promise.all([
              providerRuntime.seoulBus.nearbyStops(near, 800)
                .then((stops) => ({ stops, failed: false }))
                .catch(() => ({ stops: [] as TransitSearchResult[], failed: true })),
              providerRuntime.kakao.searchPlaces('버스정류장', near).catch(() => []),
              providerRuntime.kakao.searchPlaces('지하철역', near),
            ]);
            const officialBusStops = officialResult.stops
              .filter((stop) => stop.mode === 'BUS' && stop.coordinate)
              .map((stop) => {
                const distanceM = coordinateDistanceMeters(near, stop.coordinate!);
                return { ...stop, distanceM, walkMinutes: Math.max(1, Math.ceil(distanceM / 75)) };
              })
              .filter((stop) => stop.distanceM <= 800);
            const categoryBusStops = busPlaces
              .filter((place) => /버스정류장|버스정류소/.test(place.category ?? ''))
              .map((place) => placeToTransit(place, near, 'BUS'))
              .filter((stop) => stop.distanceM != null && stop.distanceM <= 800);
            const confirmedStations = subwayPlaces.filter((place) =>
              /지하철|전철|철도역/.test(place.category ?? ''));
            // Official name lookup is a second independent bus-index path when
            // the positional endpoint is empty. Search only nearby confirmed
            // station names; validate each returned stop's actual coordinates.
            const closestStation = confirmedStations
              .slice()
              .sort((left, right) =>
                coordinateDistanceMeters(near, left.coordinate) -
                coordinateDistanceMeters(near, right.coordinate))[0];
            const nearestStationName = closestStation?.placeName
              ?.replace(/\s*\d+호선.*$/, '').trim() ?? '';
            const stationNamedBusStops = !officialBusStops.length && nearestStationName
              ? await providerRuntime.seoulBus.searchStops(nearestStationName, near)
                .catch(() => [])
              : [];
            const matchingOfficialStops = stationNamedBusStops
              .filter((point) => point.mode === 'BUS' && point.coordinate)
              .map((point) => {
                const distanceM = coordinateDistanceMeters(near, point.coordinate!);
                return { ...point, distanceM, walkMinutes: Math.max(1, Math.ceil(distanceM / 75)) };
              })
              .filter((point) => point.distanceM <= 800);
            const buses = officialBusStops.length ? officialBusStops :
              matchingOfficialStops.length ? matchingOfficialStops : categoryBusStops;
            return json({
              results: trimNearbyTransitByDistance([
                ...buses,
                ...confirmedStations.map((place) => placeToTransit(place, near, 'SUBWAY')),
              ]),
              sourceStatus: {
                bus: officialBusStops.length ? 'OFFICIAL' :
                  matchingOfficialStops.length ? 'OFFICIAL_STATION_NAME' :
                  categoryBusStops.length ? 'VERIFIED_CATEGORY_FALLBACK' :
                  officialResult.failed ? 'OFFICIAL_UNAVAILABLE' : 'NO_NEARBY_BUS',
                officialBusCount: officialBusStops.length,
                stationNameBusCount: matchingOfficialStops.length,
                categoryBusCount: categoryBusStops.length,
              },
            });
          }

          if (segments[2] === 'transit-search') {
            const query = url.searchParams.get('q')?.trim();
            const x = Number(url.searchParams.get('x'));
            const y = Number(url.searchParams.get('y'));
            if (!query) return json({ error: 'q is required.' }, 400);
            if (![x, y].every(Number.isFinite)) {
              return json({ error: 'x/y are required.' }, 400);
            }
            const near = { x, y };
            // Official transit registries only: never infer BUS from arbitrary POIs.
            const [busStops, subwayStations] = await Promise.all([
              providerRuntime.seoulBus.searchStops(query, near).catch(() => []),
              providerRuntime.seoulSubway.searchStations(query, near).catch(() => []),
            ]);
            const verified = [...busStops, ...subwayStations]
              .filter((point) => point.mode === 'BUS' || point.mode === 'SUBWAY')
              .map((point) => {
                if (!point.coordinate) return point;
                const distanceM = coordinateDistanceMeters(near, point.coordinate);
                return { ...point, distanceM, walkMinutes: Math.max(1, Math.ceil(distanceM / 75)) };
              });
            return json({ results: dedupeTransit(verified).slice(0, 30) });
          }

          if (segments[2] === 'routes') {
            if (url.hostname === 'come-back-home.pages.dev' &&
                isKakaoRouteCooldownActive(Date.now())) {
              return json({ error: 'KAKAO_ROUTE_QUOTA_BLOCKED_UNTIL_20261009_0005_KST' }, 503);
            }
            const originX = Number(url.searchParams.get('originX'));
            const originY = Number(url.searchParams.get('originY'));
            const destinationX = Number(url.searchParams.get('destinationX'));
            const destinationY = Number(url.searchParams.get('destinationY'));
            if (![originX, originY, destinationX, destinationY].every(Number.isFinite)) {
              return json({ error: 'origin/destination coordinates are required.' }, 400);
            }

            return json({
              results: await providerRuntime.kakao.publicTransitRoutes(
                { x: originX, y: originY },
                { x: destinationX, y: destinationY },
              ),
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Provider request failed.';
          if (message.startsWith('Provider activation blocked:')) {
            return json({ error: message }, 503);
          }
          throw error;
        }

        return json({ error: 'Provider adapter is not configured yet.' }, 501);
      }
    }

    if (
      segments.length === 3 &&
      segments[1] === 'presence-events' &&
      segments[2] === 'status' &&
      request.method === 'GET'
    ) {
      return json({
        configured: Boolean(env.PRESENCE_EVENT_INGEST_TOKEN?.trim()),
      });
    }

    if (
      segments.length === 3 &&
      segments[1] === 'presence-events' &&
      segments[2] === 'validate' &&
      request.method === 'POST'
    ) {
      const configuredToken = env.PRESENCE_EVENT_INGEST_TOKEN?.trim();
      if (!configuredToken) return json({ error: 'Presence event ingest is not configured.' }, 503);
      if (!isPresenceEventAuthorized(request, configuredToken)) {
        return json({ error: 'Unauthorized.' }, 401);
      }
      return json({ valid: true });
    }

    if (
      segments.length === 2 &&
      segments[1] === 'presence-events' &&
      request.method === 'POST'
    ) {
      const configuredToken = env.PRESENCE_EVENT_INGEST_TOKEN?.trim();
      if (!configuredToken) {
        return json({ error: 'Presence event ingest is not configured.' }, 503);
      }
      if (!isPresenceEventAuthorized(request, configuredToken)) {
        return json({ error: 'Unauthorized.' }, 401);
      }

      const body = await readObject(request);
      const rawType = asString(body.type, 'type');
      if (rawType !== 'LEFT_WORK' && rawType !== 'ARRIVED_HOME') {
        return json({ error: 'Presence event type is invalid.' }, 400);
      }
      const type: PresenceEventType = rawType;
      const event = await enqueuePresenceEvent(
        {
          jobs: new D1NotificationJobStore(env.DB),
          people: new D1PersonRepository(env.DB),
          schedules: new D1ScheduleRepository(env.DB),
          settings: new D1NotificationSettingsStore(env.DB),
          presence: new D1PresenceRepository(env.DB),
        },
        {
          eventId: asString(body.eventId, 'eventId'),
          personId: asString(body.personId, 'personId'),
          type,
        },
      );

      let delivery = null;
      if (event.queued) {
        const readiness = createNotificationActivationReadiness(env, providerRuntime);
        if (readiness.ready) {
          delivery = await processNotificationOutbox(
            readiness.dependencies.outbox,
            Date.now(),
          );
        }
      }

      return json({ event, delivery }, 202);
    }

    if (segments.length === 2 && segments[1] === 'bootstrap' && request.method === 'GET') {
      const people = new D1PersonRepository(env.DB);
      const notifications = new D1NotificationSettingsStore(env.DB);
      const [personList, notificationSettings] = await Promise.all([
        people.list(),
        notifications.get(),
      ]);
      return json({
        people: personList,
        notificationSettings,
        productTimezone: 'Asia/Seoul',
      });
    }

    if (
      segments.length === 3 &&
      segments[1] === 'schedules' &&
      segments[2] === 'import' &&
      request.method === 'PUT'
    ) {
      // Multi-employee import MUST be a single D1.batch write.
      // Calling the per-person routes in sequence loses all-or-none safety.
      const body = await readObject(request);
      const raw = Array.isArray(body.schedules) ? body.schedules : null;
      if (!raw || raw.length < 1 || raw.length > 700) {
        throw new Error('Import schedules must contain 1–700 rows.');
      }
      const knownIds = new Set(
        (await new D1PersonRepository(env.DB).list()).map(person => person.id),
      );
      const unique = new Set<string>();
      const entries = raw.map(item => {
        if (!isObject(item)) throw new Error('Each imported schedule must be an object.');
        const personId = asString(item.personId, 'schedule.personId');
        const date = asString(item.date, 'schedule.date');
        const id = asString(item.id, 'schedule.id');
        const start = asString(item.start, 'schedule.start');
        const end = asString(item.end, 'schedule.end');
        if (!knownIds.has(personId)) throw new Error('Import references unknown person.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Import date is invalid.');
        if (![start,end].every(clock => /^([01]\d|2[0-3]):[0-5]\d$/.test(clock))) {
          throw new Error('Import schedule clock is invalid.');
        }
        const key = personId+'|'+date;
        if (unique.has(key)) throw new Error('Duplicate person/date in import batch.');
        unique.add(key);
        const enabled = asBoolean(item.enabled, 'schedule.enabled');
        const breakMinutes = optionalScheduleBreakMinutes(item);
        return {
          id,personId,date,enabled,start,end,
          ...(breakMinutes !== undefined ? { breakMinutes } : {}),
        };
      });
      const schedules = new D1ScheduleRepository(env.DB);
      await schedules.upsertMany(entries);
      return json({ schedules: entries });
    }

    if (segments.length === 2 && segments[1] === 'people') {
      const people = new D1PersonRepository(env.DB);
      if (request.method === 'GET') return json({ people: await people.list() });
      if (request.method === 'POST') {
        const body = await readObject(request);
        const person = await people.create({
          name: asString(body.name, 'name'),
          relation: typeof body.relation === 'string' ? body.relation.trim() : '',
        });
        return json({ person }, 201);
      }
    }

    if (segments[1] === 'people' && segments[2]) {
      const personId = decodeURIComponent(segments[2]);
      const people = new D1PersonRepository(env.DB);

      if (segments.length === 3) {
        if (request.method === 'GET') {
          const person = await people.get(personId);
          return person ? json({ person }) : json({ error: 'Person was not found.' }, 404);
        }
        if (request.method === 'PATCH') {
          const body = await readObject(request);
          const person = await people.update(personId, {
            ...(typeof body.name === 'string' ? { name: body.name.trim() } : {}),
            ...(typeof body.relation === 'string' ? { relation: body.relation.trim() } : {}),
          });
          return json({ person });
        }
      }

      if (segments.length === 4 && segments[3] === 'presence' && request.method === 'GET') {
        const presence = new D1PresenceRepository(env.DB);
        return json({ presence: await presence.get(personId) });
      }

      if (segments[3] === 'schedules') {
        const schedules = new D1ScheduleRepository(env.DB);

        if (segments.length === 4 && request.method === 'GET') {
          return json({ schedules: await schedules.list(personId) });
        }

        if (segments.length === 4 && request.method === 'PUT') {
          const body = await readObject(request);
          const rawSchedules = Array.isArray(body.schedules) ? body.schedules : [];
          const entries = rawSchedules.map((value) => {
            if (!isObject(value)) throw new Error('Each schedule must be an object.');
            return {
              id: asString(value.id, 'schedule.id'),
              personId,
              date: asString(value.date, 'schedule.date'),
              enabled: asBoolean(value.enabled, 'schedule.enabled'),
              start: asString(value.start, 'schedule.start'),
              end: asString(value.end, 'schedule.end'),
              ...(optionalScheduleBreakMinutes(value) !== undefined
                ? { breakMinutes: optionalScheduleBreakMinutes(value) } : {}),
            };
          });
          await schedules.upsertMany(entries);
          return json({ schedules: entries });
        }

        if (segments[4] && segments.length === 5) {
          const date = decodeURIComponent(segments[4]);

          if (request.method === 'GET') {
            return json({ schedule: await schedules.getByDate(personId, date) });
          }

          if (request.method === 'PUT') {
            const body = await readObject(request);
            const current = await schedules.getByDate(personId, date);
            const entry = {
              id: typeof body.id === 'string' ? body.id : current?.id ?? crypto.randomUUID(),
              personId,
              date,
              enabled: asBoolean(body.enabled, 'enabled'),
              start: asString(body.start, 'start'),
              end: asString(body.end, 'end'),
              ...(optionalScheduleBreakMinutes(body) !== undefined
                ? { breakMinutes: optionalScheduleBreakMinutes(body) } : {}),
            };
            await schedules.upsert(entry);
            return json({ schedule: entry });
          }
        }
      }

      if (segments[3] === 'places' && segments[4] && segments.length === 5) {
        const kind = asPlaceKind(segments[4]);
        const places = new D1PlaceRepository(env.DB);

        if (request.method === 'GET') {
          return json({ place: await places.get(personId, kind) });
        }

        if (request.method === 'PUT') {
          const body = await readObject(request);
          const current = await places.get(personId, kind);
          const address = isObject(body.address) ? body.address : {};
          const coordinate = isObject(body.coordinate) ? body.coordinate : null;
          const place = {
            id: current?.id ?? crypto.randomUUID(),
            personId,
            kind,
            label: asString(body.label, 'label'),
            address: {
              road: asString(address.road, 'address.road'),
              ...(asOptionalString(address.lot) ? { lot: asOptionalString(address.lot) } : {}),
              ...(asOptionalString(address.detail) ? { detail: asOptionalString(address.detail) } : {}),
            },
            ...(coordinate && typeof coordinate.x === 'number' && typeof coordinate.y === 'number'
              ? { coordinate: { x: coordinate.x, y: coordinate.y } }
              : {}),
            ...(asOptionalString(body.providerPlaceId)
              ? { providerPlaceId: asOptionalString(body.providerPlaceId) }
              : {}),
          };
          await places.save(place);
          return json({ place });
        }
      }

      if (segments[3] === 'commute') {
        const commute = new D1CommuteRepository(env.DB);

        if (segments.length === 4 && request.method === 'GET') {
          const kind = asPlaceKind(url.searchParams.get('kind') ?? 'origin');
          const [accessPoints, routePreference, savedRoutes, preferredRouteCandidateId] = await Promise.all([
            commute.listAccessPoints(personId, kind),
            commute.getRoutePreference(personId),
            commute.listSavedRoutes(personId),
            commute.getPreferredRouteCandidateId(personId),
          ]);
          return json({ accessPoints, routePreference, savedRoutes, preferredRouteCandidateId });
        }

        if (segments[4] === 'preference' && segments.length === 5 && request.method === 'PUT') {
          const body = await readObject(request);
          const viaAccessPointIds = Array.isArray(body.viaAccessPointIds)
            ? body.viaAccessPointIds.filter((value): value is string => typeof value === 'string')
            : [];
          const preference: RoutePreference = {
            id: 'route-pref:' + personId,
            personId,
            originPlaceKind: 'origin',
            destinationPlaceKind: 'destination',
            viaAccessPointIds,
          };
          await commute.saveRoutePreference(preference);
          return json({ routePreference: preference });
        }

        if (segments[4] === 'routes' && segments.length === 5 && request.method === 'POST') {
          const route = await commute.createSavedRoute(personId);
          return json({ route }, 201);
        }

        if (segments[4] === 'routes' && segments[5] && segments.length === 6) {
          const routeId = decodeURIComponent(segments[5]);
          const routes = await commute.listSavedRoutes(personId);
          const current = routes.find((route) => route.id === routeId);
          if (!current) return json({ error: 'Saved commute route was not found.' }, 404);

          if (request.method === 'PATCH') {
            const body = await readObject(request);
            if (body.active === true) {
              await commute.setActiveSavedRoute(personId, routeId);
              const route = (await commute.listSavedRoutes(personId)).find((candidate) => candidate.id === routeId);
              return json({ route });
            }
            return json({ route: current });
          }

          if (request.method === 'PUT') {
            const body = await readObject(request);
            const viaAccessPointIds = Array.isArray(body.viaAccessPointIds)
              ? body.viaAccessPointIds.filter((value): value is string => typeof value === 'string')
              : current.viaAccessPointIds;
            const originAccessPointIds = Array.isArray(body.originAccessPointIds)
              ? body.originAccessPointIds.filter((value): value is string => typeof value === 'string')
              : current.originAccessPointIds ?? (current.originAccessPointId ? [current.originAccessPointId] : []);
            const destinationAccessPointIds = Array.isArray(body.destinationAccessPointIds)
              ? body.destinationAccessPointIds.filter((value): value is string => typeof value === 'string')
              : current.destinationAccessPointIds ?? (current.destinationAccessPointId ? [current.destinationAccessPointId] : []);
            const route: SavedCommuteRoute = {
              ...current,
              label: typeof body.label === 'string' && body.label.trim() ? body.label.trim() : current.label,
              originAccessPointIds,
              destinationAccessPointIds,
              viaAccessPointIds,
              active: typeof body.active === 'boolean' ? body.active : current.active,
            };
            if (Array.isArray(body.originAccessPointIds)) {
              if (originAccessPointIds[0]) route.originAccessPointId = originAccessPointIds[0];
              else delete route.originAccessPointId;
            }
            if (Array.isArray(body.destinationAccessPointIds)) {
              if (destinationAccessPointIds[0]) route.destinationAccessPointId = destinationAccessPointIds[0];
              else delete route.destinationAccessPointId;
            }
            if (typeof body.originAccessPointId === 'string' && body.originAccessPointId.trim()) {
              route.originAccessPointId = body.originAccessPointId.trim();
            } else if (body.originAccessPointId === null) {
              delete route.originAccessPointId;
            }
            if (typeof body.destinationAccessPointId === 'string' && body.destinationAccessPointId.trim()) {
              route.destinationAccessPointId = body.destinationAccessPointId.trim();
            } else if (body.destinationAccessPointId === null) {
              delete route.destinationAccessPointId;
            }
            await commute.saveSavedRoute(route);
            return json({ route });
          }
        }

        if (segments[4] === 'access' && segments[5] && segments.length === 6 && request.method === 'PUT') {
          const kind = asPlaceKind(segments[5]);
          const body = await readObject(request);
          const point: TransitAccessPoint = {
            id: typeof body.id === 'string' ? body.id : crypto.randomUUID(),
            personId,
            placeKind: kind,
            providerId: asString(body.providerId, 'providerId'),
            mode: body.mode === 'BUS' ? 'BUS' : body.mode === 'SUBWAY' ? 'SUBWAY' : (() => { throw new Error('Invalid transit mode.'); })(),
            name: asString(body.name, 'name'),
            selected: typeof body.selected === 'boolean' ? body.selected : true,
            ...(asOptionalString(body.displayCode) ? { displayCode: asOptionalString(body.displayCode) } : {}),
            ...(asOptionalString(body.line) ? { line: asOptionalString(body.line) } : {}),
            ...(typeof body.coordinate === 'object' && body.coordinate != null &&
              Number.isFinite(Number((body.coordinate as Record<string, unknown>).x)) &&
              Number.isFinite(Number((body.coordinate as Record<string, unknown>).y))
              ? { coordinate: {
                  x: Number((body.coordinate as Record<string, unknown>).x),
                  y: Number((body.coordinate as Record<string, unknown>).y),
                } }
              : {}),
            ...(Number.isFinite(Number(body.distanceM)) ? { distanceM: Number(body.distanceM) } : {}),
            ...(Number.isFinite(Number(body.walkMinutes)) ? { walkMinutes: Number(body.walkMinutes) } : {}),
            ...(asOptionalString(body.userLabel) ? { userLabel: asOptionalString(body.userLabel) } : {}),
            ...(asOptionalString(body.selectedBusRouteId) ? { selectedBusRouteId: asOptionalString(body.selectedBusRouteId) } : {}),
          };
          await commute.upsertAccessPoint(point);
          const canonical = (await commute.listAccessPoints(personId, kind))
            .find((saved) => saved.providerId === point.providerId && saved.mode === point.mode);
          if (!canonical) return json({ error: 'Transit access write was not readable.' }, 500);
          return json({ accessPoint: canonical });
        }

        if (segments[4] === 'preferred-route' && segments.length === 5 && request.method === 'PUT') {
          const body = await readObject(request);
          const routeCandidateId = asString(body.routeCandidateId, 'routeCandidateId');
          await commute.setPreferredRouteCandidateId(personId, routeCandidateId);
          return json({ preferredRouteCandidateId: routeCandidateId });
        }
      }
    }

    if (segments[1] === 'commute' && segments[2] === 'access' && segments[3] && segments.length === 4 && request.method === 'PATCH') {
      const accessPointId = decodeURIComponent(segments[3]);
      const body = await readObject(request);
      const commute = new D1CommuteRepository(env.DB);

      if (typeof body.selected === 'boolean') {
        await commute.setAccessPointSelected(accessPointId, body.selected);
      }
      if (typeof body.userLabel === 'string') {
        await commute.setAccessPointAlias(accessPointId, body.userLabel);
      }
      if (typeof body.selectedBusRouteId === 'string' && body.selectedBusRouteId.trim()) {
        await commute.setSelectedBusRoute(accessPointId, body.selectedBusRouteId.trim());
      }

      return json({ updated: true });
    }

    if (segments.length === 3 && segments[1] === 'notifications' && segments[2] === 'settings') {
      const settings = new D1NotificationSettingsStore(env.DB);
      if (request.method === 'GET') return json({ settings: await settings.get() });
      if (request.method === 'PUT') {
        const body = await readObject(request);
        const updated = await settings.updateRules({
          shiftEndEnabled: asBoolean(body.shiftEndEnabled, 'shiftEndEnabled'),
          etaChangeEnabled: asBoolean(body.etaChangeEnabled, 'etaChangeEnabled'),
          leftWorkEnabled: asBoolean(body.leftWorkEnabled, 'leftWorkEnabled'),
          homeArrivalEnabled: asBoolean(body.homeArrivalEnabled, 'homeArrivalEnabled'),
        });
        return json({ settings: updated });
      }
    }

    // The VAPID applicationServerKey is intentionally PUBLIC. Read from the
    // actual Pages runtime to avoid assuming a runtime env var was injected
    // into Vite's build-time import.meta.env.
    if (segments.length === 3 && segments[1] === 'notifications' &&
        segments[2] === 'client-key' && request.method === 'GET') {
      const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? '';
      return json({
        configured: /^[A-Za-z0-9_-]{80,100}$/.test(publicKey),
        publicKey: /^[A-Za-z0-9_-]{80,100}$/.test(publicKey) ? publicKey : null,
        source: 'PAGES_RUNTIME',
      });
    }

    if (segments.length === 3 && segments[1] === 'notifications' &&
        segments[2] === 'readiness' && request.method === 'GET') {
      const push = inspectPushDeliveryConfig(env);
      const scheduled = createNotificationActivationReadiness(env, providerRuntime);
      const activeSubscriptions = await new D1SubscriptionStore(env.DB).listActive();
      const activeSubscriptionCount = activeSubscriptions.length;
      const validSubscriptionKeyShapeCount = activeSubscriptions.filter(
        (item) => pushSubscriptionKeyShapeValid(item.keys)).length;
      const vapidKeyPairValid = await verifyVapidKeyPair(env);
      return json({
        vapidConfigured: !push.missing.some((value) => value.startsWith('VAPID_')),
        pushDeliveryReady: push.ready && vapidKeyPairValid && activeSubscriptionCount > 0,
        pushTransportConfigured: push.ready && vapidKeyPairValid,
        vapidKeyPairValid,
        pushMissing: push.missing,
        activeSubscriptionCount,
        validSubscriptionKeyShapeCount,
        scheduledNotificationReady: scheduled.ready,
        scheduledMissing: scheduled.missing,
        valuesExposed: false,
      });
    }

    if (
      segments.length === 3 &&
      segments[1] === 'notifications' &&
      segments[2] === 'test' &&
      request.method === 'POST'
    ) {
      const body = await readObject(request);
      const endpoint = asString(body.endpoint, 'endpoint');
      // Test push must not depend on Kakao, ETA or scheduled-notification
      // planner readiness. Only VAPID, TTL, flag and the target D1 subscription.
      const delivery = createPushDeliveryRuntime(env);
      if (!delivery.ready || !delivery.gateway || !delivery.subscriptions) {
        return json({
          error: 'Push delivery runtime is not ready.',
          reason: delivery.missing.some((value) => value.startsWith('VAPID_'))
            ? 'VAPID_CONFIG_MISSING' : 'PUSH_RUNTIME_NOT_READY',
          missing: delivery.missing,
        }, 503);
      }

      const subscriptions = delivery.subscriptions;
      const active = await subscriptions.listActive();
      const subscription = active.find((item) => item.endpoint === endpoint);
      if (!subscription) return json({
        error: 'Active push subscription was not found.',
        reason: 'SUBSCRIPTION_NOT_REGISTERED',
      }, 404);

      try {
        await delivery.gateway.send(subscription, {
          title: 'ComeBackHome',
          body: '테스트 알림입니다.',
          tag: 'cbh:test',
          path: '/notifications',
        });
      } catch (error) {
        if (error instanceof PushDeliveryError && error.kind === 'terminal-subscription') {
          await subscriptions.deactivateByEndpoint(endpoint);
          return json({ error: 'Push subscription is no longer active.', reason: 'STALE_SUBSCRIPTION' }, 410);
        }
        const classified = classifyPushProviderFailure(error);
        return json({
          error: 'Test push delivery failed.',
          reason: classified.reason,
          // Upstream status is safe to disclose; never serialize a provider
          // response body, subscription endpoint, keys or exception message.
          upstreamStatus: classified.upstreamStatus,
        }, 502);
      }

      return json({ sent: true });
    }

    if (segments.length === 4 && segments[1] === 'push' &&
        segments[2] === 'subscription' && segments[3] === 'status' &&
        request.method === 'POST') {
      // Read-only identity comparison. The private endpoint travels in a
      // request body, never a URL or public response.
      const body = await readObject(request);
      const endpoint = asString(body.endpoint, 'endpoint');
      const existing = await new D1SubscriptionStore(env.DB).listActive();
      return json({ registered: existing.some((item) => item.endpoint === endpoint) });
    }

    if (segments.length === 3 && segments[1] === 'push' && segments[2] === 'subscription') {
      const subscriptions = new D1SubscriptionStore(env.DB);

      if (request.method === 'PUT') {
        const body = await readObject(request);
        const keys = isObject(body.keys) ? body.keys : {};
        const subscription: WebPushSubscriptionRecord = {
          endpoint: asString(body.endpoint, 'endpoint'),
          expirationTime: typeof body.expirationTime === 'number' ? body.expirationTime : null,
          keys: {
            p256dh: asString(keys.p256dh, 'keys.p256dh'),
            auth: asString(keys.auth, 'keys.auth'),
          },
        };
        await subscriptions.upsert(subscription);
        return json({ stored: true });
      }

      if (request.method === 'DELETE') {
        const body = await readObject(request);
        await subscriptions.deactivateByEndpoint(asString(body.endpoint, 'endpoint'));
        return json({ stored: false });
      }
    }

    return json({ error: 'API route not found.' }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}
