/** Product dates are Korean calendar dates regardless of the device timezone. */
export function seoulDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function seoulTime(now: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(now);
}

export function shiftTimes(entry: { date: string; start: string; end: string }): { start: number; end: number } {
  const start = Date.parse(`${entry.date}T${entry.start}:00+09:00`);
  let end = Date.parse(`${entry.date}T${entry.end}:00+09:00`);
  if (end < start) end += 86_400_000;
  return { start, end };
}

/** Keep an overnight shift through its commute window, then show today's shift. */
export function activeWorkSchedule<T extends { date: string; start: string; end: string; enabled: boolean }>(entries: T[], now: Date): T | null {
  const today = seoulDate(now);
  const current = entries.find(entry => entry.enabled && entry.date === today) ?? null;
  const previous = entries.filter(entry => entry.enabled && entry.date < today && entry.end < entry.start)
    .filter(entry => now.getTime() < shiftTimes(entry).end + 4 * 60 * 60_000)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (previous && (!current || now.getTime() < shiftTimes(current).start)) return previous;
  return current;
}
export function previousSeoulDate(now: Date): string { return seoulDate(new Date(now.getTime() - 86_400_000)); }
