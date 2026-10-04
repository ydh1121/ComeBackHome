import type { ScheduleEntry } from '../../domain/models';

export function formatDateLabel(iso: string): string {
  if (!iso) return '—';
  const date = new Date(iso + 'T00:00:00Z');
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()} ${weekdays[date.getUTCDay()]}`;
}

export function formatMonthLabel(iso: string): string {
  if (!iso) return '—';
  const date = new Date(iso + 'T00:00:00Z');
  return `${date.getUTCFullYear()}년 ${date.getUTCMonth() + 1}월`;
}

export function sortSchedule(entries: ScheduleEntry[]): ScheduleEntry[] {
  return [...entries].sort((a, b) => a.date.localeCompare(b.date));
}

export function normalizeRange(from: string, to: string): { from: string; to: string } {
  return from <= to ? { from, to } : { from: to, to: from };
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
