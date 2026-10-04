import type { EntityId, ISODate } from '../../domain/common';
import type { NotificationRules, PlaceKind, TransitMode } from '../../domain/models';

export type ImportInputFile = { kind: 'WORKBOOK'; file: File } | { kind: 'IMAGE'; file: File };
export interface ImportFileSelectionAction { accept(files: ImportInputFile[]): Promise<EntityId>; }
export interface CommitImportReviewAction { execute(batchId: EntityId): Promise<void>; }
export type TransitAccessFilter = 'all' | Lowercase<TransitMode>;
export interface TransitAccessActions {
  setFilter(kind: PlaceKind, filter: TransitAccessFilter): void;
  toggleAccess(accessPointId: EntityId, selected: boolean): Promise<void>;
}
export interface NotificationActions {
  requestPermissionFromUserGesture(): Promise<void>;
  updateRules(rules: NotificationRules): Promise<void>;
  sendTestNotification(): Promise<void>;
}
export interface PersonSelectionActions {
  getSelectedPersonId(): EntityId | null;
  select(personId: EntityId): void;
}
export interface ScheduleDayInput {
  enabled: boolean;
  start: string;
  end: string;
}
export interface ScheduleBulkRule {
  from: ISODate;
  to: ISODate;
  weekdays: number[];
  start: string;
  end: string;
}
export interface ScheduleActions {
  saveDay(date: ISODate, input: ScheduleDayInput): Promise<void>;
  applyBulk(rule: ScheduleBulkRule): Promise<void>;
}
