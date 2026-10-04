import type { EntityId } from '../../domain/common';
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
