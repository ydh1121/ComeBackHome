export type EntityId = string;
export type ISODate = string;
export type ISODateTime = string;
export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error' | 'offline';
export type SaveStatus = 'clean' | 'dirty' | 'saving' | 'saved' | 'error';
export type PermissionState = 'default' | 'denied' | 'granted' | 'subscribed' | 'error';
export interface AsyncState<T> { status: AsyncStatus; data: T | null; errorMessage?: string; }
