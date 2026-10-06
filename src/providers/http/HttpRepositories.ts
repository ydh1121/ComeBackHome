import type { PushSubscriptionTransport } from '../../application/contracts/providers';
import type {
  CommuteRepository,
  NotificationRepository,
  PersonRepository,
  PlaceRepository,
  ScheduleRepository,
} from '../../application/contracts/repositories';
import type { EntityId, ISODate } from '../../domain/common';
import type {
  NotificationRules,
  NotificationSettings,
  Person,
  Place,
  PlaceKind,
  RouteCandidate,
  RoutePreference,
  ScheduleEntry,
  TransitAccessPoint,
  WebPushSubscriptionRecord,
} from '../../domain/models';
import { HttpJsonClient } from './HttpJsonClient';

export class HttpPersonRepository implements PersonRepository {
  constructor(private readonly client: HttpJsonClient) {}

  async list(): Promise<Person[]> {
    return (await this.client.get<{ people: Person[] }>('/people')).people;
  }

  async get(id: EntityId): Promise<Person | null> {
    try {
      return (await this.client.get<{ person: Person }>('/people/' + encodeURIComponent(id))).person;
    } catch (error) {
      if (error instanceof Error && error.message === 'Person was not found.') return null;
      throw error;
    }
  }

  async create(input: Omit<Person, 'id'>): Promise<Person> {
    return (await this.client.post<{ person: Person }>('/people', input)).person;
  }

  async update(id: EntityId, patch: Partial<Omit<Person, 'id'>>): Promise<Person> {
    return (await this.client.patch<{ person: Person }>('/people/' + encodeURIComponent(id), patch)).person;
  }
}

export class HttpScheduleRepository implements ScheduleRepository {
  constructor(private readonly client: HttpJsonClient) {}

  async list(personId: EntityId): Promise<ScheduleEntry[]> {
    return (await this.client.get<{ schedules: ScheduleEntry[] }>(
      '/people/' + encodeURIComponent(personId) + '/schedules',
    )).schedules;
  }

  async getByDate(personId: EntityId, date: ISODate): Promise<ScheduleEntry | null> {
    return (await this.client.get<{ schedule: ScheduleEntry | null }>(
      '/people/' + encodeURIComponent(personId) + '/schedules/' + encodeURIComponent(date),
    )).schedule;
  }

  async upsert(entry: ScheduleEntry): Promise<void> {
    await this.client.put(
      '/people/' + encodeURIComponent(entry.personId) + '/schedules/' + encodeURIComponent(entry.date),
      entry,
    );
  }

  async upsertMany(entries: ScheduleEntry[]): Promise<void> {
    if (!entries.length) return;
    const personId = entries[0].personId;
    if (entries.some((entry) => entry.personId !== personId)) {
      throw new Error('Schedule batch must belong to one person.');
    }
    await this.client.put(
      '/people/' + encodeURIComponent(personId) + '/schedules',
      { schedules: entries },
    );
  }
}

export class HttpPlaceRepository implements PlaceRepository {
  constructor(private readonly client: HttpJsonClient) {}

  async get(personId: EntityId, kind: PlaceKind): Promise<Place | null> {
    return (await this.client.get<{ place: Place | null }>(
      '/people/' + encodeURIComponent(personId) + '/places/' + kind,
    )).place;
  }

  async save(place: Place): Promise<void> {
    await this.client.put(
      '/people/' + encodeURIComponent(place.personId) + '/places/' + place.kind,
      place,
    );
  }
}

interface CommuteSnapshotResponse {
  accessPoints: TransitAccessPoint[];
  routePreference: RoutePreference | null;
  preferredRouteCandidateId: EntityId | null;
}

export class HttpCommuteRepository implements CommuteRepository {
  constructor(private readonly client: HttpJsonClient) {}

  private getSnapshot(personId: EntityId, kind: PlaceKind): Promise<CommuteSnapshotResponse> {
    return this.client.get<CommuteSnapshotResponse>(
      '/people/' + encodeURIComponent(personId) + '/commute?kind=' + kind,
    );
  }

  async listAccessPoints(personId: EntityId, kind: PlaceKind): Promise<TransitAccessPoint[]> {
    return (await this.getSnapshot(personId, kind)).accessPoints;
  }

  async upsertAccessPoint(point: TransitAccessPoint): Promise<void> {
    await this.client.put(
      '/people/' + encodeURIComponent(point.personId) + '/commute/access/' + point.placeKind,
      point,
    );
  }

  async setAccessPointSelected(accessPointId: EntityId, selected: boolean): Promise<void> {
    await this.client.patch('/commute/access/' + encodeURIComponent(accessPointId), { selected });
  }

  async setAccessPointAlias(accessPointId: EntityId, userLabel: string): Promise<void> {
    await this.client.patch('/commute/access/' + encodeURIComponent(accessPointId), { userLabel });
  }

  async setSelectedBusRoute(accessPointId: EntityId, providerRouteId: string): Promise<void> {
    await this.client.patch('/commute/access/' + encodeURIComponent(accessPointId), {
      selectedBusRouteId: providerRouteId,
    });
  }

  async getRoutePreference(personId: EntityId): Promise<RoutePreference | null> {
    return (await this.getSnapshot(personId, 'origin')).routePreference;
  }

  async saveRoutePreference(preference: RoutePreference): Promise<void> {
    await this.client.put(
      '/people/' + encodeURIComponent(preference.personId) + '/commute/preference',
      { viaAccessPointIds: preference.viaAccessPointIds },
    );
  }

  async listRouteCandidates(_personId: EntityId): Promise<RouteCandidate[]> {
    return [];
  }

  async getPreferredRouteCandidateId(personId: EntityId): Promise<EntityId | null> {
    return (await this.getSnapshot(personId, 'origin')).preferredRouteCandidateId;
  }

  async setPreferredRouteCandidateId(personId: EntityId, routeCandidateId: EntityId): Promise<void> {
    await this.client.put(
      '/people/' + encodeURIComponent(personId) + '/commute/preferred-route',
      { routeCandidateId },
    );
  }
}

export class HybridCommuteRepository implements CommuteRepository {
  constructor(
    private readonly persisted: CommuteRepository,
    private readonly runtime: CommuteRepository,
  ) {}

  async listAccessPoints(personId: EntityId, kind: PlaceKind): Promise<TransitAccessPoint[]> {
    const [persisted, runtime] = await Promise.all([
      this.persisted.listAccessPoints(personId, kind),
      this.runtime.listAccessPoints(personId, kind),
    ]);
    const runtimeByProvider = new Map(runtime.map((point) => [point.providerId, point]));

    return persisted.map((point) => {
      const live = runtimeByProvider.get(point.providerId);
      return {
        ...point,
        ...(live?.walkMinutes === undefined ? {} : { walkMinutes: live.walkMinutes }),
        ...(live?.busRoutes ? { busRoutes: live.busRoutes } : {}),
      };
    });
  }

  async upsertAccessPoint(point: TransitAccessPoint): Promise<void> {
    await this.persisted.upsertAccessPoint(point);
    await this.runtime.upsertAccessPoint(point);
  }

  async setAccessPointSelected(accessPointId: EntityId, selected: boolean): Promise<void> {
    await this.persisted.setAccessPointSelected(accessPointId, selected);
    await this.runtime.setAccessPointSelected(accessPointId, selected);
  }

  async setAccessPointAlias(accessPointId: EntityId, userLabel: string): Promise<void> {
    await this.persisted.setAccessPointAlias(accessPointId, userLabel);
    await this.runtime.setAccessPointAlias(accessPointId, userLabel);
  }

  async setSelectedBusRoute(accessPointId: EntityId, providerRouteId: string): Promise<void> {
    await this.persisted.setSelectedBusRoute(accessPointId, providerRouteId);
    await this.runtime.setSelectedBusRoute(accessPointId, providerRouteId);
  }

  getRoutePreference(personId: EntityId): Promise<RoutePreference | null> {
    return this.persisted.getRoutePreference(personId);
  }

  saveRoutePreference(preference: RoutePreference): Promise<void> {
    return this.persisted.saveRoutePreference(preference);
  }

  listRouteCandidates(personId: EntityId): Promise<RouteCandidate[]> {
    return this.runtime.listRouteCandidates(personId);
  }

  getPreferredRouteCandidateId(personId: EntityId): Promise<EntityId | null> {
    return this.persisted.getPreferredRouteCandidateId(personId);
  }

  setPreferredRouteCandidateId(personId: EntityId, routeCandidateId: EntityId): Promise<void> {
    return this.persisted.setPreferredRouteCandidateId(personId, routeCandidateId);
  }
}

interface ServerNotificationSettings {
  shiftEndEnabled: boolean;
  etaChangeEnabled: boolean;
  leftWorkEnabled: boolean;
  homeArrivalEnabled: boolean;
  timezone: string;
  updatedAt: string;
}

export class HttpNotificationRepository implements NotificationRepository {
  private permission: NotificationSettings['permission'] = 'default';
  private subscription: WebPushSubscriptionRecord | null = null;

  constructor(
    private readonly client: HttpJsonClient,
    private readonly onLocalChange: () => void = () => undefined,
  ) {}

  async getSettings(): Promise<NotificationSettings> {
    const settings = (await this.client.get<{ settings: ServerNotificationSettings }>(
      '/notifications/settings',
    )).settings;
    return {
      permission: this.permission,
      subscription: this.subscription,
      rules: {
        shiftEnd: settings.shiftEndEnabled,
        etaChange: settings.etaChangeEnabled,
        leftWork: settings.leftWorkEnabled,
        homeArrival: settings.homeArrivalEnabled,
      },
    };
  }

  async setRules(rules: NotificationRules): Promise<void> {
    await this.client.put('/notifications/settings', {
      shiftEndEnabled: rules.shiftEnd,
      etaChangeEnabled: rules.etaChange,
      leftWorkEnabled: rules.leftWork,
      homeArrivalEnabled: rules.homeArrival,
    });
  }

  async setPermission(permission: NotificationSettings['permission']): Promise<void> {
    this.permission = permission;
    this.onLocalChange();
  }

  async setSubscription(subscription: WebPushSubscriptionRecord | null): Promise<void> {
    this.subscription = subscription;
    this.onLocalChange();
  }
}

export class HttpPushSubscriptionTransport implements PushSubscriptionTransport {
  constructor(private readonly client: HttpJsonClient) {}

  async upsert(subscription: WebPushSubscriptionRecord): Promise<void> {
    await this.client.put('/push/subscription', subscription);
  }

  async remove(endpoint: string): Promise<void> {
    await this.client.delete('/push/subscription', { endpoint });
  }
}
