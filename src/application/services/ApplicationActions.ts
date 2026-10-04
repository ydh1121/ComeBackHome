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
import type { NotificationPermissionProvider, NotificationTestGateway, PushSubscriptionProvider } from '../contracts/providers';
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
    const weekdays = new Set(rule.weekdays);

    const updated = entries.flatMap((entry) => {
      const weekday = new Date(entry.date + 'T00:00:00Z').getUTCDay();
      const inRange = entry.date >= rule.from && entry.date <= rule.to;
      const daySelected = weekdays.size === 0 || weekdays.has(weekday);
      if (!inRange || !daySelected) return [];

      return [{
        ...entry,
        enabled: true,
        start: rule.start || entry.start,
        end: rule.end || entry.end,
      }];
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
  ) {}

  async requestPermissionFromUserGesture(): Promise<void> {
    try {
      const permission = await this.permissionProvider.requestPermissionFromUserGesture();
      await this.repository.setPermission(permission);
      if (permission !== 'granted') {
        await this.repository.setSubscription(null);
        return;
      }
      const subscription = await this.subscriptionProvider.subscribe();
      await this.repository.setSubscription(subscription);
      await this.repository.setPermission('subscribed');
    } catch {
      await this.repository.setSubscription(null);
      await this.repository.setPermission('error');
      throw new Error('Notification permission or push subscription failed.');
    }
  }

  async disablePushSubscription(): Promise<void> {
    await this.subscriptionProvider.unsubscribe();
    await this.repository.setSubscription(null);
    const permission = await this.permissionProvider.getPermission();
    await this.repository.setPermission(permission === 'granted' ? 'granted' : permission);
  }

  updateRules(rules: NotificationRules): Promise<void> { return this.repository.setRules(rules); }
  sendTestNotification(): Promise<void> { return this.testGateway.sendTestNotification(); }
}
