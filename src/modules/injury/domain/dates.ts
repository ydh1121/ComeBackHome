export function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
  );
}
export function day(value: string): number {
  if (!validDate(value)) throw new Error("INVALID_DATE");
  return Date.parse(value + "T00:00:00Z");
}
export function addDays(value: string, amount: number): string {
  return new Date(day(value) + amount * 86400000).toISOString().slice(0, 10);
}
export function addMonths(value: string, amount: number): string {
  day(value);
  const [y, m, d] = value.split("-").map(Number),
    target = new Date(Date.UTC(y, m - 1 + amount, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
export function inclusiveDays(from: string, to: string): number {
  const n = (day(to) - day(from)) / 86400000 + 1;
  if (n < 1 || n > 36525) throw new Error("INVALID_PERIOD");
  return n;
}
export function dates(from: string, to: string): string[] {
  return Array.from({ length: inclusiveDays(from, to) }, (_, i) =>
    addDays(from, i),
  );
}
export function todaySeoul(instant = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}
