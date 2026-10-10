import type { EntityId, ISODate } from '../domain/common';
import type { ImportBatch, ImportFileRecord, ImportResolution, NotificationRules, NotificationSettings, Person, Place, PlaceKind, PresenceState, RouteCandidate, RoutePreference, SavedCommuteRoute, ScheduleEntry, TodaySnapshot, TransitAccessPoint, WebPushSubscriptionRecord } from '../domain/models';
import type { ApprovedWeeklyImport, ApprovedImportReceipt, CommuteRepository, ImportRepository, NotificationRepository, PersonRepository, PlaceRepository, PresenceRepository, ScheduleRepository, TodayRepository } from '../application/contracts/repositories';
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
  async importApprovedWeekly(input: ApprovedWeeklyImport): Promise<ApprovedImportReceipt> {
    const snapshot = this.store.read();
    if (!input.confirmed || !input.weekStart) throw new Error('WEEKLY_DATES_NOT_CONFIRMED');
    const monday=new Date(input.weekStart+'T00:00:00Z');
    if (!Number.isFinite(monday.getTime()) || monday.getUTCDay()!==1 ||
        monday.toISOString().slice(0,10)!==input.weekStart)
      throw new Error('INVALID_WEEKLY_START_DATE');
    const existing = new Set(snapshot.people.map(p=>p.id));
    const pending = new Map(input.newPeople.map(person=>[person.ref,{
      id:'mock-atomic-'+input.requestId+'-'+person.ref,name:person.name,relation:'',
    }]));
    if(pending.size!==input.newPeople.length)
      throw new Error('DUPLICATE_NEW_PERSON_REF');
    for(const person of pending.values()){
      if(snapshot.people.some(p=>p.name===person.name&&p.id!==person.id))
        throw new Error('NEW_PERSON_NAME_ALREADY_EXISTS');
    }
    const candidate = clone(snapshot.schedules);
    const rows: ScheduleEntry[]=[];
    const unique = new Set<string>();
    for(const row of input.schedules){
      if(row.approved!==true||row.decision!=='NEW')
        throw new Error('UNAPPROVED_IMPORT_SCHEDULE');
      const personId=row.personId??pending.get(row.pendingPersonRef??'')?.id;
      if(!personId || (!existing.has(personId)&&![...pending.values()].some(p=>p.id===personId)))
        throw new Error('Import references unknown person.');
      const date=new Date(monday.getTime()+row.dayIndex*86400000).toISOString().slice(0,10);
      if(row.date!==date)throw new Error('UNCONFIRMED_WEEKLY_DAY');
      if(![row.start,row.end].every(x=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(x)))
        throw new Error('Import schedule clock is invalid.');
      if(row.recognitionState==='OFF_CANDIDATE'&&!row.enabled&&!row.offApproved)
        throw new Error('UNAPPROVED_OFF_CANDIDATE');
      const key=personId+'|'+date;
      if(unique.has(key))throw new Error('Duplicate person/date in import batch.');
      unique.add(key);
      const entry={id:row.id,personId,date,enabled:row.enabled,start:row.start,
        end:row.end,...(row.breakMinutes!==undefined?{breakMinutes:row.breakMinutes}:{})};
      rows.push(entry);
      const index=candidate.findIndex(x=>x.personId===personId&&x.date===date);
      if(index>=0)candidate[index]={...candidate[index],...entry,id:candidate[index].id};
      else candidate.push(entry);
    }
    const mapping=Object.fromEntries([...pending].map(([ref,person])=>[ref,person.id]));
    this.store.mutate(state=>{
      for(const person of pending.values())
        if(!state.people.some(p=>p.id===person.id))state.people.push(person);
      state.schedules=candidate;
    });
    return {createdPeople:mapping,schedules:rows};
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
  async addManualPerson(batchId:EntityId,personId:EntityId,name:string):Promise<void> {
    const batch=this.store.read().importBatches.find(b=>b.id===batchId);
    if(batch?.structure.weeklyReview?.status!=='MANUAL_RECOVERY_REQUIRED')
      throw new Error('MANUAL_RECOVERY_NOT_ACTIVE');
    if(batch.detectedPeople.some(p=>p.matchedPersonId===personId))
      throw new Error('MANUAL_PERSON_ALREADY_INCLUDED');
    const id=crypto.randomUUID();
    this.store.mutate(state=>{
      const target=state.importBatches.find(b=>b.id===batchId);
      if(!target)return;
      target.detectedPeople.push({id,sourceName:name,matchedPersonId:personId,confidence:0,ignored:false});
      for(let dayIndex=0;dayIndex<7;dayIndex++)target.reviewItems.push({
        id:crypto.randomUUID(),detectedPersonId:id,personId,date:null,dayIndex,
        imported:{enabled:true,start:null,end:null,breakMinutes:null},
        recognitionState:'UNREADABLE',resolution:null,
      });
    });
  }
  async setWeeklyStartDate(batchId:EntityId,startDate:ISODate):Promise<void> {
    const before=this.store.read().importBatches.find(b=>b.id===batchId);
    if(!before?.structure.weeklyReview)throw new Error('WEEKLY_DATE_REVIEW_NOT_ACTIVE');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate))
      throw new Error('INVALID_WEEK_START_DATE');
    const start=new Date(startDate+'T00:00:00Z');
    if(!Number.isFinite(start.getTime())||start.toISOString().slice(0,10)!==startDate||
       start.getUTCDay()!==1)throw new Error('WEEK_START_MUST_BE_MONDAY');
    if(before.reviewItems.some(item=>item.dayIndex==null||item.dayIndex<0||item.dayIndex>6))
      throw new Error('MISSING_WEEKDAY_OWNERSHIP');
    this.store.mutate(state=>{
      const batch=state.importBatches.find(b=>b.id===batchId);
      if(!batch?.structure.weeklyReview)return;
      for(const item of batch.reviewItems){
        item.date=new Date(start.getTime()+item.dayIndex!*86400000).toISOString().slice(0,10);
        item.existing=undefined;
        item.resolution=null;
      }
      batch.structure.weeklyReview.startDate=startDate;
      batch.structure.weeklyReview.confirmed=false;
    });
  }
  async confirmWeeklyDates(batchId:EntityId):Promise<void> {
    const batch=this.store.read().importBatches.find(b=>b.id===batchId);
    if(!batch?.structure.weeklyReview?.startDate)throw new Error('WEEKLY_START_DATE_REQUIRED');
    const start=new Date(batch.structure.weeklyReview.startDate+'T00:00:00Z');
    if(!Number.isFinite(start.getTime())||start.toISOString().slice(0,10)!==
       batch.structure.weeklyReview.startDate||start.getUTCDay()!==1)
      throw new Error('WEEKLY_START_DATE_INVALID');
    if(batch.reviewItems.some(item=>item.dayIndex==null||
       item.date!==new Date(start.getTime()+item.dayIndex*86400000).toISOString().slice(0,10)))
      throw new Error('WEEKLY_DATE_CONFLICT');
    this.store.mutate(state=>{
      const target=state.importBatches.find(b=>b.id===batchId);
      if(!target?.structure.weeklyReview)return;
      target.structure.weeklyReview.confirmed=true;
      target.reviewItems.forEach(item=>{item.resolution=null;});
    });
  }
  async setPendingNewPerson(batchId:EntityId,detectedPersonId:EntityId,proposedName:string):Promise<void> {
    const name=proposedName.normalize('NFKC').trim();
    if(!/^[가-힣]{2,5}$/.test(name))throw new Error('INVALID_NEW_PERSON_NAME');
    const batch=this.store.read().importBatches.find(b=>b.id===batchId);
    if(!batch?.structure.weeklyReview)throw new Error('NEW_PERSON_REVIEW_NOT_ACTIVE');
    this.store.mutate(state=>{
      const target=state.importBatches.find(b=>b.id===batchId);
      const person=target?.detectedPeople.find(p=>p.id===detectedPersonId);
      if(!person||!target)return;
      person.pendingCreateName=name;
      person.matchedPersonId=null;
      person.ignored=false;
      for(const item of target.reviewItems)if(item.detectedPersonId===detectedPersonId){
        item.personId=null;
        item.resolution=null;
      }
    });
  }
  async setDetectedPersonMatch(batchId: EntityId, detectedPersonId: EntityId, personId: EntityId | null): Promise<void> {
    this.store.mutate((state) => {
      const batch = state.importBatches.find((candidate) => candidate.id === batchId);
      const person = batch?.detectedPeople.find((candidate) => candidate.id === detectedPersonId);
      if (person) { person.matchedPersonId = personId; person.pendingCreateName=undefined; }
      for (const item of batch?.reviewItems ?? []) {
        if (item.detectedPersonId !== detectedPersonId) continue;
        item.personId = personId;
        if (personId && item.resolution == null &&
            batch?.structure.sheet !== 'weekly 7 day x start/end/break physical matrix') {
          item.resolution = 'NEW';
        }
      }
    });
  }
  async setDetectedPersonIgnored(batchId: EntityId, detectedPersonId: EntityId, ignored: boolean): Promise<void> {
    this.store.mutate((state) => {
      const batch = state.importBatches.find((candidate) => candidate.id === batchId);
      const person = batch?.detectedPeople.find((candidate) => candidate.id === detectedPersonId);
      if (!person || !batch) return;
      person.ignored = ignored;
      if (ignored) { person.matchedPersonId = null; person.pendingCreateName=undefined; }
      for (const item of batch.reviewItems) {
        if (item.detectedPersonId !== detectedPersonId) continue;
        if (ignored) {
          item.personId = null;
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
      if (batch?.structure.sheet === 'weekly 7 day x start/end/break physical matrix') {
        item.resolution = null;
      }
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
