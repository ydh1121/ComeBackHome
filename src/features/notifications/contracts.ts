import type { PermissionState, SaveStatus } from '../../domain/common';
export interface NotificationViewState { permission: PermissionState; saveStatus: SaveStatus; testStatus: 'idle' | 'sending' | 'sent' | 'error'; }
