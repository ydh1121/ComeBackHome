import { isIsoDate } from '../../features/schedule/date-format';
import { PushClientError, categorizePushError } from '../../features/notifications/pushErrors';
import type { EntityId } from '../../domain/common';
import type { NotificationRules, PlaceKind } from '../../domain/models';
import type {
  NotificationActions,
  PersonActions,
  PersonInput,
  PersonSelectionActions,
  ScheduleActions,
  ScheduleBulkRule,
  ScheduleDayInput,
  TransitAccessActions,
  TransitAccessFilter,
} from '../contracts/actions';
import type { NotificationPermissionProvider, NotificationTestGateway, PushSubscriptionProvider, PushSubscriptionTransport } from '../contracts/providers';
import type { CommuteRepository, NotificationRepository, PersonRepository, ScheduleRepository } from '../contracts/repositories';

export class PersonService implements PersonActions {
  constructor(
    private readonly people: PersonRepository,
    private readonly selection: PersonSelectionActions,
  ) {}

  async create(input: PersonInput) {
    const name = input.name.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!name) throw new Error('Person name is required.');
    const person = await this.people.create({ name, relation: input.relation.trim() });
    this.selection.select(person.id);
    return person;
  }

  async update(personId: EntityId, input: PersonInput) {
    const current = await this.people.get(personId);
    if (!current) throw new Error('Person was not found.');
    return this.people.update(personId, {
      name: input.name.normalize('NFKC').trim().replace(/\s+/g, ' ') || current.name,
      relation: input.relation.trim() || current.relation,
    });
  }
}

export class PersonSelectionService implements PersonSelectionActions {
  constructor(private selectedPersonId: EntityId | null, private readonly onChange: () => void) {}
  getSelectedPersonId(): EntityId | null { return this.selectedPersonId; }
  select(personId: EntityId): void {
    if (personId === this.selectedPersonId) return;
    this.selectedPersonId = personId;
    this.onChange();
  }
}

function validClock(value: string): boolean {
  return /^([01]\\d|2[0-3]):[0-5]\\d$/.test(value);
}

function validateScheduleInput(date: string, enabled: boolean, start: string, end: string, breakMinutes?: number | null): void {
  if (!isIsoDate(date)) throw new Error('INVALID_SCHEDULE_DATE');
  if (enabled && (!validClock(start) || !validClock(end))) throw new Error('INVALID_SCHEDULE_CLOCK');
  if (breakMinutes != null && (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 720)) {
    throw new Error('INVALID_BREAK_MINUTES');
  }
}

function enumerateScheduleDates(from: string, to: string): string[] {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw new Error('Schedule range is invalid.');
  const start = Date.parse(from + 'T00:00:00Z');
  const end = Date.parse(to + 'T00:00:00Z');
  const count = Math.round((end - start) / 86_400_000) + 1;
  if (count > 366) throw new Error('Schedule range is too large.');
  return Array.from({ length: count }, (_, i) =>
    new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}

export class ScheduleService implements ScheduleActions {
  constructor(
    private readonly schedules: ScheduleRepository,
    private readonly selection: PersonSelectionActions,
  ) {}

  async saveDay(date: string, input: ScheduleDayInput): Promise<void> {
    const personId = this.selection.getSelectedPersonId();
    if (!personId || (input.expectedPersonId && input.expectedPersonId !== personId))
      throw new Error('SELECTED_PERSON_CHANGED');
    validateScheduleInput(date, input.enabled, input.start, input.end, input.breakMinutes);
    const current = await this.schedules.getByDate(personId, date);
    if (this.selection.getSelectedPersonId() !== personId) throw new Error('SELECTED_PERSON_CHANGED');
    await this.schedules.upsert({
      id: current?.id ?? crypto.randomUUID(), personId, date,
      enabled: input.enabled,
      start: input.enabled ? input.start : '',
      end: input.enabled ? input.end : '',
      // undefined means preserve on work edits; explicit null clears it.
      breakMinutes: input.enabled ? input.breakMinutes : null,
    });
  }

  async applyBulk(rule: ScheduleBulkRule): Promise<void> {
    const personId = this.selection.getSelectedPersonId();
    if (!personId || (rule.expectedPersonId && rule.expectedPersonId !== personId))
      throw new Error('SELECTED_PERSON_CHANGED');
    if (!validClock(rule.start) || !validClock(rule.end)) throw new Error('INVALID_SCHEDULE_CLOCK');
    if (!rule.weekdays.every(day => Number.isInteger(day) && day >= 0 && day <= 6))
      throw new Error('INVALID_SCHEDULE_WEEKDAYS');
    const dates = enumerateScheduleDates(rule.from, rule.to);
    const days = new Set(rule.weekdays);
    const targetDates = dates.filter(date => days.size === 0 ||
      days.has(new Date(date + 'T00:00:00Z').getUTCDay()));
    if (!targetDates.length) throw new Error('NO_SCHEDULE_DATES_MATCH');
    const entries = await this.schedules.list(personId);
    if (this.selection.getSelectedPersonId() !== personId) throw new Error('SELECTED_PERSON_CHANGED');
    const byDate = new Map(entries.map(entry => [entry.date, entry]));
    const updated = targetDates.map(date => {
      const current = byDate.get(date);
      return { id: current?.id ?? crypto.randomUUID(), personId, date,
        enabled: true, start: rule.start, end: rule.end,
        breakMinutes: current?.enabled ? undefined : null };
    });
    // HttpScheduleRepository sends the entire set in ONE request; the D1
    // repository executes it in ONE batch, never per-day HTTP mutations.
    await this.schedules.upsertMany(updated);
  }
}

export class TransitAccessService implements TransitAccessActions {
  private readonly filters = new Map<PlaceKind, TransitAccessFilter>([['origin', 'all'], ['destination', 'all']]);
  constructor(private readonly commute: CommuteRepository, private readonly onChange: () => void) {}
  setFilter(kind: PlaceKind, filter: TransitAccessFilter): void { this.filters.set(kind, filter); this.onChange(); }
  getFilter(kind: PlaceKind): TransitAccessFilter { return this.filters.get(kind) ?? 'all'; }
  async toggleAccess(accessPointId: EntityId, selected: boolean): Promise<void> { await this.commute.setAccessPointSelected(accessPointId, selected); }
}

export class NotificationService implements NotificationActions {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly permissionProvider: NotificationPermissionProvider,
    private readonly subscriptionProvider: PushSubscriptionProvider,
    private readonly testGateway: NotificationTestGateway,
    private readonly subscriptionTransport?: PushSubscriptionTransport,
  ) {}

  async syncCurrentSubscription(): Promise<void> {
    try {
      await this.subscriptionProvider.prepare?.().catch(() => undefined);
      const permission = await this.permissionProvider.getPermission();
      if (permission !== 'granted') {
        await this.repository.setSubscription(null);
        await this.repository.setPermission(permission);
        return;
      }
      const current = await this.subscriptionProvider.getCurrent();
      if (!current) {
        await this.repository.setSubscription(null);
        await this.repository.setPermission('granted');
        return;
      }
      if (this.subscriptionProvider.isCompatible &&
          !(await this.subscriptionProvider.isCompatible())) {
        await this.repository.setSubscription(null);
        await this.repository.setPermission('stale');
        return;
      }
      if (this.subscriptionTransport) {
        const registered = this.subscriptionTransport.checkRegistered
          ? await this.subscriptionTransport.checkRegistered(current.endpoint)
          : false;
        if (!registered) await this.subscriptionTransport.upsert(current);
      }
      await this.repository.setSubscription(current);
      await this.repository.setPermission('subscribed');
    } catch (error) {
      await this.repository.setSubscription(null);
      await this.repository.setPermission('error');
      throw new PushClientError(categorizePushError(error));
    }
  }

  async connectPushFromUserGesture(): Promise<void> {
    try {
      // WebKit requires the permission prompt to be invoked from the tap.
      // An awaited browser permission query before requestPermission() can
      // discard the transient user activation on iPhone Home Screen PWAs.
      const snapshot = this.permissionProvider.getPermissionSnapshot?.();
      const before = snapshot ?? await this.permissionProvider.getPermission();
      if (before === 'denied') throw new PushClientError('NO_PERMISSION');
      // Only request if permission is not already granted. The prompt
      // is initiated before the first await in the real browser adapter.
      const permission = before === 'granted'
        ? before : await this.permissionProvider.requestPermissionFromUserGesture();
      await this.repository.setPermission(permission);
      if (permission !== 'granted') {
        await this.repository.setSubscription(null);
        throw new PushClientError('NO_PERMISSION');
      }
      const previous = await this.subscriptionProvider.getCurrent();
      if (previous && this.subscriptionProvider.isCompatible &&
          !(await this.subscriptionProvider.isCompatible())) {
        await this.subscriptionProvider.unsubscribe();
      }
      const subscription = await this.subscriptionProvider.subscribe();
      if (this.subscriptionTransport) {
        await this.subscriptionTransport.upsert(subscription);
        // Retire stale endpoint only after the new subscription is stored.
        if (previous && previous.endpoint !== subscription.endpoint) {
          await this.subscriptionTransport.remove(previous.endpoint);
        }
        if (this.subscriptionTransport.checkRegistered &&
            !(await this.subscriptionTransport.checkRegistered(subscription.endpoint))) {
          throw new PushClientError('SERVER_REGISTER_FAILED');
        }
      }
      await this.repository.setSubscription(subscription);
      await this.repository.setPermission('subscribed');
    } catch (error) {
      const reason = categorizePushError(error);
      await this.repository.setSubscription(null);
      await this.repository.setPermission(reason === 'STALE_SUBSCRIPTION' ? 'stale' : 'error');
      throw new PushClientError(reason);
    }
  }

  requestPermissionFromUserGesture(): Promise<void> {
    return this.connectPushFromUserGesture();
  }

  async disablePushSubscription(): Promise<void> {
    const current = await this.subscriptionProvider.getCurrent();
    if (current && this.subscriptionTransport) {
      await this.subscriptionTransport.remove(current.endpoint);
    }
    await this.subscriptionProvider.unsubscribe();
    await this.repository.setSubscription(null);
    const permission = await this.permissionProvider.getPermission();
    await this.repository.setPermission(permission === 'granted' ? 'granted' : permission);
  }

  updateRules(rules: NotificationRules): Promise<void> {
    return this.repository.setRules(rules);
  }

  async sendTestNotification(): Promise<void> {
    const permission = await this.permissionProvider.getPermission();
    if (permission !== 'granted') throw new PushClientError('NO_PERMISSION');
    const current = await this.subscriptionProvider.getCurrent();
    if (!current) {
      await this.repository.setSubscription(null);
      await this.repository.setPermission('granted');
      throw new PushClientError('NO_SUBSCRIPTION');
    }
    if (this.subscriptionProvider.isCompatible &&
        !(await this.subscriptionProvider.isCompatible())) {
      await this.repository.setSubscription(null);
      await this.repository.setPermission('stale');
      throw new PushClientError('STALE_SUBSCRIPTION');
    }
    try {
      if (this.subscriptionTransport) {
        const registered = this.subscriptionTransport.checkRegistered
          ? await this.subscriptionTransport.checkRegistered(current.endpoint)
          : false;
        if (!registered) await this.subscriptionTransport.upsert(current);
      }
      await this.testGateway.sendTestNotification();
    } catch (error) {
      const reason = categorizePushError(error);
      if (reason === 'STALE_SUBSCRIPTION') {
        await this.repository.setSubscription(null);
        await this.repository.setPermission('stale');
      }
      throw new PushClientError(reason);
    }
  }
}
