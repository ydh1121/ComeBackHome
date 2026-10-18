import type { ScheduleEntry } from '../../domain/models';

export function formatDateLabel(iso: string): string {
  if (!iso) return '—';
  const date = new Date(iso + 'T00:00:00Z');
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()} ${weekdays[date.getUTCDay()]}`;
}

export function sortSchedule(entries: ScheduleEntry[]): ScheduleEntry[] {
  return [...entries].sort((a, b) => a.date.localeCompare(b.date));
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
