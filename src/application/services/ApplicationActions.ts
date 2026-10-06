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
    const name = input.name.trim();
    if (!name) throw new Error('Person name is required.');
    const person = await this.people.create({ name, relation: input.relation.trim() });
    this.selection.select(person.id);
    return person;
  }

  async update(personId: EntityId, input: PersonInput) {
    const current = await this.people.get(personId);
    if (!current) throw new Error('Person was not found.');
    return this.people.update(personId, {
      name: input.name.trim() || current.name,
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

function enumerateScheduleDates(from: string, to: string): string[] {
  const start = Date.parse(from + 'T00:00:00Z');
  const end = Date.parse(to + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    throw new Error('Schedule range is invalid.');
  }

  const dayMs = 86_400_000;
  const dayCount = Math.floor((end - start) / dayMs) + 1;
  if (dayCount > 366) throw new Error('Schedule range is too large.');

  return Array.from({ length: dayCount }, (_, index) =>
    new Date(start + index * dayMs).toISOString().slice(0, 10),
  );
}

export class ScheduleService implements ScheduleActions {
  constructor(
    private readonly schedules: ScheduleRepository,
    private readonly selection: PersonSelectionActions,
  ) {}

  async saveDay(date: string, input: ScheduleDayInput): Promise<void> {
    const personId = this.selection.getSelectedPersonId();
    if (!personId) throw new Error('Selected person is required.');
    const current = await this.schedules.getByDate(personId, date);
    await this.schedules.upsert({
      id: current?.id ?? crypto.randomUUID(),
      personId,
      date,
      enabled: input.enabled,
      start: input.start,
      end: input.end,
    });
  }

  async applyBulk(rule: ScheduleBulkRule): Promise<void> {
    const personId = this.selection.getSelectedPersonId();
    if (!personId) throw new Error('Selected person is required.');

    const entries = await this.schedules.list(personId);
    const byDate = new Map(entries.map((entry) => [entry.date, entry]));
    const weekdays = new Set(rule.weekdays);
    const targetDates = enumerateScheduleDates(rule.from, rule.to)
      .filter((date) => weekdays.size === 0 || weekdays.has(new Date(date + 'T00:00:00Z').getUTCDay()));

    const updated = targetDates.map((date) => {
      const current = byDate.get(date);
      const start = rule.start || current?.start || '';
      const end = rule.end || current?.end || '';
      if (!start || !end) {
        throw new Error('Bulk schedule start and end times are required when creating dates.');
      }

      return {
        id: current?.id ?? crypto.randomUUID(),
        personId,
        date,
        enabled: true,
        start,
        end,
      };
    });

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
      const permission = await this.permissionProvider.getPermission();
      if (permission !== 'granted') {
        await this.repository.setSubscription(null);
        await this.repository.setPermission(permission);
        return;
      }

      const subscription = await this.subscriptionProvider.getCurrent();
      if (!subscription) {
        await this.repository.setSubscription(null);
        await this.repository.setPermission('granted');
        return;
      }

      if (this.subscriptionTransport) {
        await this.subscriptionTransport.upsert(subscription);
      }
      await this.repository.setSubscription(subscription);
      await this.repository.setPermission('subscribed');
    } catch {
      await this.repository.setSubscription(null);
      await this.repository.setPermission('error');
      throw new Error('Notification subscription sync failed.');
    }
  }

  async requestPermissionFromUserGesture(): Promise<void> {
    try {
      const permission = await this.permissionProvider.requestPermissionFromUserGesture();
      await this.repository.setPermission(permission);
      if (permission !== 'granted') {
        await this.repository.setSubscription(null);
        return;
      }
      const subscription = await this.subscriptionProvider.subscribe();
      if (this.subscriptionTransport) {
        try {
          await this.subscriptionTransport.upsert(subscription);
        } catch (error) {
          await this.subscriptionProvider.unsubscribe().catch(() => undefined);
          throw error;
        }
      }
      await this.repository.setSubscription(subscription);
      await this.repository.setPermission('subscribed');
    } catch {
      await this.repository.setSubscription(null);
      await this.repository.setPermission('error');
      throw new Error('Notification permission or push subscription failed.');
    }
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

  updateRules(rules: NotificationRules): Promise<void> { return this.repository.setRules(rules); }
  sendTestNotification(): Promise<void> { return this.testGateway.sendTestNotification(); }
}
