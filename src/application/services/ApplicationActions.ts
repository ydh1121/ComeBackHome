import type { EntityId } from '../../domain/common';
import type { NotificationRules, PlaceKind } from '../../domain/models';
import type { NotificationActions, PersonSelectionActions, TransitAccessActions, TransitAccessFilter } from '../contracts/actions';
import type { NotificationPermissionProvider, NotificationTestGateway } from '../contracts/providers';
import type { CommuteRepository, NotificationRepository } from '../contracts/repositories';

export class PersonSelectionService implements PersonSelectionActions {
  constructor(private selectedPersonId: EntityId | null, private readonly onChange: () => void) {}
  getSelectedPersonId(): EntityId | null { return this.selectedPersonId; }
  select(personId: EntityId): void {
    if (personId === this.selectedPersonId) return;
    this.selectedPersonId = personId;
    this.onChange();
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
  constructor(private readonly repository: NotificationRepository, private readonly permissionProvider: NotificationPermissionProvider, private readonly testGateway: NotificationTestGateway) {}
  async requestPermissionFromUserGesture(): Promise<void> { const permission = await this.permissionProvider.requestPermissionFromUserGesture(); await this.repository.setPermission(permission); }
  updateRules(rules: NotificationRules): Promise<void> { return this.repository.setRules(rules); }
  sendTestNotification(): Promise<void> { return this.testGateway.sendTestNotification(); }
}
