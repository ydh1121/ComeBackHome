import type { EntityId, ISODate } from '../domain/common';
import type { ImportBatch, ImportFileRecord, ImportResolution, NotificationRules, NotificationSettings, Person, Place, PlaceKind, PresenceState, RouteCandidate, RoutePreference, SavedCommuteRoute, ScheduleEntry, TodaySnapshot, TransitAccessPoint, WebPushSubscriptionRecord } from '../domain/models';
import type { CommuteRepository, ImportRepository, NotificationRepository, PersonRepository, PlaceRepository, PresenceRepository, ScheduleRepository, TodayRepository } from '../application/contracts/repositories';
import type { MockStateStore } from './state';
function clone<T>(value: T): T { return structuredClone(value); }

export class MockPersonRepository implements PersonRepository {
  constructor(private readonly store: MockStateStore) {}
  async list(): Promise<Person[]> { return clone(this.store.read().people); }
  async get(id: EntityId): Promise<Person | null> { return clone(this.store.read().people.find((person) => person.id === id) ?? null); }
  async create(input: Omit<Person, 'id'>): Promise<Person> { const person = { id: crypto.randomUUID(), ...input }; this.store.mutate((state) => state.people.push(person)); return clone(person); }
  async update(id: EntityId, patch: Partial<Omit<Person, 'id'>>): Promise<Person> { let updated: Person | null = null; this.store.mutate((state) => { const person = state.people.find((candidate) => candidate.id === id); if (!person) return; Object.assign(person, patch); updated = clone(person); }); if (!updated) throw new Error('Person was not found.'); return updated; }
}

export class MockScheduleRepository implements ScheduleRepository {
  constructor(private readonly store: MockStateStore) {}
  async list(personId: EntityId): Promise<ScheduleEntry[]> { return clone(this.store.read().schedules.filter((entry) => entry.personId === personId)); }
  async getByDate(personId: EntityId, date: ISODate): Promise<ScheduleEntry | null> { return clone(this.store.read().schedules.find((entry) => entry.personId === personId && entry.date === date) ?? null); }
  async upsert(entry: ScheduleEntry): Promise<void> {
    this.store.mutate((state) => {
      const index = state.schedules.findIndex((candidate) => candidate.id === entry.id || (candidate.personId === entry.personId && candidate.date === entry.date));
      if (index >= 0) state.schedules[index] = clone(entry);
      else state.schedules.push(clone(entry));
    });
  }
  async upsertMany(entries: ScheduleEntry[]): Promise<void> {
    const draft = clone(this.store.read().schedules);
    for (const entry of entries) {
      const index = draft.findIndex((candidate) => candidate.id === entry.id || (candidate.personId === entry.personId && candidate.date === entry.date));
      if (index >= 0) draft[index] = clone(entry);
      else draft.push(clone(entry));
    }
    this.store.mutate((state) => { state.schedules = draft; });
  }
}


export class MockPresenceRepository implements PresenceRepository {
  private readonly state = new Map<string, PresenceState>();
  private readonly events = new Set<string>();

  async get(personId: EntityId): Promise<PresenceState | null> {
    return clone(this.state.get(personId) ?? null);
  }

  async record(input: {
    eventId: string;
    personId: EntityId;
    type: 'LEFT_WORK' | 'ARRIVED_HOME';
    acceptedAt: string;
    workDate: ISODate;
  }): Promise<{ state: PresenceState; duplicate: boolean }> {
    if (this.events.has(input.eventId)) {
      const current = this.state.get(input.personId);
      if (!current) throw new Error('Presence event exists without current state.');
      return { state: clone(current), duplicate: true };
    }
    this.events.add(input.eventId);
    const current = this.state.get(input.personId);
    const sameDate = current?.workDate === input.workDate;
    const next: PresenceState = {
      personId: input.personId,
      workDate: input.workDate,
      ...(input.type === 'LEFT_WORK'
        ? { leftWorkAt: input.acceptedAt }
        : sameDate && current?.leftWorkAt
          ? { leftWorkAt: current.leftWorkAt }
          : {}),
      ...(input.type === 'ARRIVED_HOME' ? { arrivedHomeAt: input.acceptedAt } : {}),
    };
    this.state.set(input.personId, next);
    return { state: clone(next), duplicate: false };
  }
}

export class MockPlaceRepository implements PlaceRepository {
  constructor(private readonly store: MockStateStore) {}
  async get(personId: EntityId, kind: PlaceKind): Promise<Place | null> { return clone(this.store.read().places.find((place) => place.personId === personId && place.kind === kind) ?? null); }
  async save(place: Place): Promise<void> { this.store.mutate((state) => { const index = state.places.findIndex((candidate) => candidate.id === place.id || (candidate.personId === place.personId && candidate.kind === place.kind)); if (index >= 0) state.places[index] = clone(place); else state.places.push(clone(place)); }); }
}

export class MockCommuteRepository implements CommuteRepository {
  constructor(private readonly store: MockStateStore) {}
  async listAccessPoints(personId: EntityId, kind: PlaceKind): Promise<TransitAccessPoint[]> { return clone(this.store.read().accessPoints.filter((point) => point.personId === personId && point.placeKind === kind)); }
  async upsertAccessPoint(point: TransitAccessPoint): Promise<void> {
    this.store.mutate((state) => {
      const index = state.accessPoints.findIndex((candidate) => candidate.id === point.id || (candidate.personId === point.personId && candidate.placeKind === point.placeKind && candidate.providerId === point.providerId));
      if (index >= 0) state.accessPoints[index] = clone(point);
      else state.accessPoints.push(clone(point));
    });
  }
  async setAccessPointSelected(accessPointId: EntityId, selected: boolean): Promise<void> { this.store.mutate((state) => { const point = state.accessPoints.find((candidate) => candidate.id === accessPointId); if (point) point.selected = selected; }); }
  async setAccessPointAlias(accessPointId: EntityId, userLabel: string): Promise<void> { this.store.mutate((state) => { const point = state.accessPoints.find((candidate) => candidate.id === accessPointId); if (point) point.userLabel = userLabel || undefined; }); }
  async setSelectedBusRoute(accessPointId: EntityId, providerRouteId: string): Promise<void> { this.store.mutate((state) => { const point = state.accessPoints.find((candidate) => candidate.id === accessPointId); if (point?.busRoutes?.some((route) => route.providerRouteId === providerRouteId)) point.selectedBusRouteId = providerRouteId; }); }
  async getRoutePreference(personId: EntityId): Promise<RoutePreference | null> { return clone(this.store.read().routePreferences.find((preference) => preference.personId === personId) ?? null); }
  async saveRoutePreference(preference: RoutePreference): Promise<void> { this.store.mutate((state) => { const index = state.routePreferences.findIndex((candidate) => candidate.id === preference.id || candidate.personId === preference.personId); if (index >= 0) state.routePreferences[index] = clone(preference); else state.routePreferences.push(clone(preference)); }); }
  async listSavedRoutes(personId: EntityId): Promise<SavedCommuteRoute[]> { return clone(this.store.read().savedRoutes.filter((route) => route.personId === personId).sort((a, b) => a.position - b.position)); }
  async createSavedRoute(personId: EntityId): Promise<SavedCommuteRoute> {
    const routes = this.store.read().savedRoutes.filter((route) => route.personId === personId);
    const position = Math.max(0, ...routes.map((route) => route.position)) + 1;
    const route: SavedCommuteRoute = { id: crypto.randomUUID(), personId, position, label: '경로 ' + position, viaAccessPointIds: [], active: routes.length === 0 };
    this.store.mutate((state) => state.savedRoutes.push(clone(route)));
    return clone(route);
  }
  async saveSavedRoute(route: SavedCommuteRoute): Promise<void> {
    this.store.mutate((state) => {
      if (route.active) {
        state.savedRoutes.filter((candidate) => candidate.personId === route.personId).forEach((candidate) => { candidate.active = false; });
        delete state.preferredRouteCandidateIds[route.personId];
      }
      const index = state.savedRoutes.findIndex((candidate) => candidate.id === route.id);
      if (index >= 0) state.savedRoutes[index] = clone(route);
      else state.savedRoutes.push(clone(route));
    });
  }
  async setActiveSavedRoute(personId: EntityId, routeId: EntityId): Promise<void> {
    this.store.mutate((state) => state.savedRoutes.filter((route) => route.personId === personId).forEach((route) => { route.active = route.id === routeId; }));
  }
  async listRouteCandidates(personId: EntityId): Promise<RouteCandidate[]> { return clone(this.store.read().routeCandidates.filter((candidate) => candidate.personId === personId)); }
  async getPreferredRouteCandidateId(personId: EntityId): Promise<EntityId | null> { return this.store.read().preferredRouteCandidateIds[personId] ?? null; }
  async setPreferredRouteCandidateId(personId: EntityId, routeCandidateId: EntityId): Promise<void> { this.store.mutate((state) => { state.preferredRouteCandidateIds[personId] = routeCandidateId; }); }
}

export class MockTodayRepository implements TodayRepository {
  constructor(private readonly store: MockStateStore) {}
  async get(personId: EntityId): Promise<TodaySnapshot | null> { return clone(this.store.read().todaySnapshots.find((snapshot) => snapshot.personId === personId) ?? null); }
}

export class MockImportRepository implements ImportRepository {
  constructor(private readonly store: MockStateStore) {}
  async getCurrentBatch() { return clone([...this.store.read().importBatches].reverse().find((batch) => !batch.committed) ?? null); }
  async getBatch(batchId: EntityId) { return clone(this.store.read().importBatches.find((batch) => batch.id === batchId) ?? null); }
  async createBatch() {
    this.store.mutate((state) => {
      state.importBatches = [];
    });
    const batch = {
      id: crypto.randomUUID(),
      files: [],
      detectedPeople: [],
      structure: { sheet: '', headerRow: 0, personColumn: '', dateColumn: '', shiftColumn: '', needsReview: true },
      reviewItems: [],
      committed: false,
    };
    this.store.mutate((state) => { state.importBatches.push(clone(batch)); });
    return clone(batch);
  }
  async replaceFiles(batchId: EntityId, files: ImportFileRecord[]): Promise<void> {
    this.store.mutate((state) => {
      const batch = state.importBatches.find((candidate) => candidate.id === batchId);
      if (batch) batch.files = clone(files);
    });
  }
  async replaceParsedResult(batchId: EntityId, result: Pick<ImportBatch, 'detectedPeople' | 'structure' | 'reviewItems'>): Promise<void> {
    this.store.mutate((state) => {
      const batch = state.importBatches.find((candidate) => candidate.id === batchId);
      if (!batch) return;
      batch.detectedPeople = clone(result.detectedPeople);
      batch.structure = clone(result.structure);
      batch.reviewItems = clone(result.reviewItems);
      batch.committed = false;
    });
  }
  async setDetectedPersonMatch(batchId: EntityId, detectedPersonId: EntityId, personId: EntityId | null): Promise<void> {
    this.store.mutate((state) => {
      const batch = state.importBatches.find((candidate) => candidate.id === batchId);
      const person = batch?.detectedPeople.find((candidate) => candidate.id === detectedPersonId);
      const changed = Boolean(person && (person.matchedPersonId !== personId || person.pendingCreate));
      if (person) { person.matchedPersonId = personId; person.pendingCreate = false; person.ignored = false; }
      for (const item of batch?.reviewItems ?? []) {
        if (item.detectedPersonId !== detectedPersonId) continue;
        item.personId = personId;
        if (changed) { item.resolution = null; item.existing = undefined; }
        // Matching a person never grants review approval; user must reapprove.
      }
    });
  }
  async setPendingPersonCreate(batchId: EntityId, detectedPersonId: EntityId, pending: boolean): Promise<void> {
    this.store.mutate(state => {
      const batch = state.importBatches.find(b => b.id === batchId);
      const detected = batch?.detectedPeople.find(p => p.id === detectedPersonId);
      if (!detected || !batch) throw new Error('Detected person not found.');
      detected.pendingCreate = pending;
      detected.matchedPersonId = null;
      detected.ignored = false;
      for (const item of batch.reviewItems) {
        if (item.detectedPersonId !== detectedPersonId) continue;
        item.personId = null;
        item.existing = undefined;
        item.resolution = null;
      }
    });
  }
  async setDetectedPersonIgnored(batchId: EntityId, detectedPersonId: EntityId, ignored: boolean): Promise<void> {
    this.store.mutate((state) => {
      const batch = state.importBatches.find((candidate) => candidate.id === batchId);
      const person = batch?.detectedPeople.find((candidate) => candidate.id === detectedPersonId);
      if (!person || !batch) return;
      const changed = person.ignored !== ignored;
      person.ignored = ignored;
      if (ignored) { person.matchedPersonId = null; person.pendingCreate = false; }
      for (const item of batch.reviewItems) {
        if (item.detectedPersonId !== detectedPersonId) continue;
        if (ignored || changed) {
          if (ignored) item.personId = null;
          item.resolution = null;
        }
      }
    });
  }

  async setResolution(batchId: EntityId, reviewItemId: EntityId, resolution: ImportResolution): Promise<void> {
    this.store.mutate((state) => {
      const item = state.importBatches.find((batch) => batch.id === batchId)?.reviewItems.find((candidate) => candidate.id === reviewItemId);
      if (item) item.resolution = resolution;
    });
  }
  async setImportedEnabled(batchId: EntityId, reviewItemId: EntityId, enabled: boolean): Promise<void> {
    this.store.mutate((state) => {
      const item = state.importBatches.find((batch) => batch.id === batchId)
        ?.reviewItems.find((candidate) => candidate.id === reviewItemId);
      if (!item) return;
      item.imported.enabled = enabled;
      if (!enabled) {
        item.imported.start = null;
        item.imported.end = null;
        item.imported.breakMinutes = null;
      }
      item.resolution = null;
    });
  }
  async setImportedDate(batchId: EntityId, reviewItemId: EntityId, date: ISODate): Promise<void> {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
       new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date) {
      throw new Error('INVALID_IMPORT_DATE');
    }
    const batch=this.store.read().importBatches.find(candidate=>candidate.id===batchId);
    const item=batch?.reviewItems.find(candidate=>candidate.id===reviewItemId);
    if(!batch||!item)throw new Error('Review item not found.');
    if(batch.reviewItems.some(other=>other.id!==item.id &&
       other.detectedPersonId===item.detectedPersonId && other.date===date)) {
      throw new Error('DUPLICATE_PERSON_IMPORT_DATE');
    }
    if(item.date===date)return;
    this.store.mutate(state=>{
      const review=state.importBatches.find(b=>b.id===batchId)?.reviewItems.find(i=>i.id===reviewItemId);
      if(review){review.date=date;review.existing=undefined;review.resolution=null;}
    });
  }

  async setImportedBreakMinutes(batchId: EntityId, reviewItemId: EntityId, minutes: number | null): Promise<void> {
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 720)) {
      throw new Error('INVALID_BREAK_MINUTES');
    }
    this.store.mutate((state) => {
      const item = state.importBatches.find((batch) => batch.id === batchId)?.reviewItems.find((candidate) => candidate.id === reviewItemId);
      if (!item || item.imported.breakMinutes === minutes) return;
      item.imported.breakMinutes = minutes;
      item.resolution = null;
    });
  }
  async setImportedTime(batchId: EntityId, reviewItemId: EntityId, field: 'start' | 'end', value: string | null): Promise<void> {
    this.store.mutate((state) => {
      const item = state.importBatches.find((batch) => batch.id === batchId)?.reviewItems.find((candidate) => candidate.id === reviewItemId);
      if (!item || item.imported[field] === value) return;
      item.imported[field] = value;
      const batch = state.importBatches.find((candidate) => candidate.id === batchId);
      item.resolution = null;
    });
  }
  async markCommitted(batchId: EntityId): Promise<void> {
    this.store.mutate((state) => {
      const batch = state.importBatches.find((candidate) => candidate.id === batchId);
      if (batch) batch.committed = true;
      if (!state.committedImportBatchIds.includes(batchId)) state.committedImportBatchIds.push(batchId);
    });
  }
}

export class MockNotificationRepository implements NotificationRepository {
  constructor(private readonly store: MockStateStore) {}
  async getSettings(): Promise<NotificationSettings> { return clone(this.store.read().notifications); }
  async setRules(rules: NotificationRules): Promise<void> { this.store.mutate((state) => { state.notifications.rules = clone(rules); }); }
  async setPermission(permission: NotificationSettings['permission']): Promise<void> { this.store.mutate((state) => { state.notifications.permission = permission; }); }
  async setSubscription(subscription: WebPushSubscriptionRecord | null): Promise<void> { this.store.mutate((state) => { state.notifications.subscription = clone(subscription); }); }
}
