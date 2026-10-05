import type { PlaceKind, RoutePreference, TransitAccessPoint, WebPushSubscriptionRecord } from '../src/domain/models';
import { D1CommuteRepository } from './repositories/D1CommuteRepository';
import { D1NotificationSettingsStore } from './repositories/D1NotificationSettingsStore';
import { D1PersonRepository } from './repositories/D1PersonRepository';
import { D1PlaceRepository } from './repositories/D1PlaceRepository';
import { D1ScheduleRepository } from './repositories/D1ScheduleRepository';
import { D1SubscriptionStore } from './repositories/D1SubscriptionStore';
import type { WorkerEnv } from './runtime-types';

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

function asPlaceKind(value: string): PlaceKind {
  if (value !== 'origin' && value !== 'destination') throw new Error('Invalid place kind.');
  return value;
}

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : 'Unexpected API error.';
  return json({ error: message }, 400);
}

export async function handleApiRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0] !== 'api') return json({ error: 'Not found.' }, 404);

  try {
    if (segments.length === 2 && segments[1] === 'health' && request.method === 'GET') {
      const row = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
      return json({ ok: row?.ok === 1 });
    }

    if (segments[1] === 'providers' && request.method === 'GET') {
      const enabled = env.PROVIDER_RUNTIME_ENABLED === '1';

      if (segments.length === 3 && segments[2] === 'status') {
        return json({
          enabled,
          source: enabled ? 'worker-provider' : 'unconfigured',
        });
      }

      if (
        segments.length === 3 &&
        (segments[2] === 'place-search' || segments[2] === 'transit-search')
      ) {
        if (!enabled) {
          return json({ error: 'Provider runtime is disabled.' }, 503);
        }

        return json({ error: 'Provider adapter is not configured yet.' }, 501);
      }
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
          const [accessPoints, routePreference, preferredRouteCandidateId] = await Promise.all([
            commute.listAccessPoints(personId, kind),
            commute.getRoutePreference(personId),
            commute.getPreferredRouteCandidateId(personId),
          ]);
          return json({ accessPoints, routePreference, preferredRouteCandidateId });
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
            ...(asOptionalString(body.userLabel) ? { userLabel: asOptionalString(body.userLabel) } : {}),
            ...(asOptionalString(body.selectedBusRouteId) ? { selectedBusRouteId: asOptionalString(body.selectedBusRouteId) } : {}),
          };
          await commute.upsertAccessPoint(point);
          return json({ accessPoint: point });
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
        });
        return json({ settings: updated });
      }
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
