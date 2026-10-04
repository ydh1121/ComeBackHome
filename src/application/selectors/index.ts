import type { ISODate } from '../../domain/common';
import type { RouteCandidate, ScheduleEntry, TransitAccessPoint } from '../../domain/models';
import type { TransitAccessFilter } from '../contracts/actions';
export function selectVisibleAccessPoints(points: TransitAccessPoint[], filter: TransitAccessFilter): TransitAccessPoint[] { if (filter === 'all') return points; const mode = filter === 'bus' ? 'BUS' : 'SUBWAY'; return points.filter((point) => point.mode === mode); }
export function rankRouteCandidates(candidates: RouteCandidate[]): RouteCandidate[] { return [...candidates].sort((a, b) => a.totalMinutes - b.totalMinutes || a.transferCount - b.transferCount || a.walkMinutes - b.walkMinutes); }
export function selectEnabledSchedule(entries: ScheduleEntry[]): ScheduleEntry[] { return entries.filter((entry) => entry.enabled).sort((a, b) => a.date.localeCompare(b.date)); }
export function selectNextShift(entries: ScheduleEntry[], after: ISODate): ScheduleEntry | null { return selectEnabledSchedule(entries).find((entry) => entry.date >= after) ?? null; }
