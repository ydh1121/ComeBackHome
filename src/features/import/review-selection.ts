import type { ImportResolution, ImportReviewItem } from '../../domain/models';

/** A visible proposal only. Repository approval is written by the final Save gesture. */
export function isReviewOff(item: ImportReviewItem): boolean {
  return item.imported.enabled === false;
}

export function canImportReviewItem(item: ImportReviewItem): boolean {
  if (isReviewOff(item)) return true;
  const { start, end, breakMinutes } = item.imported;
  const validTime = (value: string | null): value is string =>
    value != null && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (!validTime(start) || !validTime(end)) return false;
  const minutes = (time: string) => Number(time.slice(0,2)) * 60 + Number(time.slice(3));
  const duration = (minutes(end) - minutes(start) + 1440) % 1440;
  if (!duration || ((item.breakReviewRequired || item.recognitionState === 'INCOMPLETE') && breakMinutes == null)) return false;
  return breakMinutes == null || (Number.isInteger(breakMinutes) && breakMinutes >= 0 &&
    breakMinutes <= 720 && breakMinutes < duration);
}

export function reviewSelection(item: ImportReviewItem): ImportResolution {
  if (item.resolution != null) return item.resolution;
  // BLANK and UNREADABLE remain excluded unless the user supplies valid times
  // or explicitly changes the cell to OFF. Source evidence is never rewritten.
  return canImportReviewItem(item) ? 'NEW' : 'SKIP';
}
