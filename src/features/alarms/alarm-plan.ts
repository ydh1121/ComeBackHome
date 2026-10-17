import type { ScheduleEntry } from '../../domain/models';
import { seoulDate, seoulTime, shiftTimes } from '../../domain/product-time';

export interface ClockAlarmTarget { id: string; label: string; fireAt: string; clockTime: string; workDate: string; kind: 'START_MINUS_90' | 'END_PLUS_30'; }
export interface ClockAlarmPlan {
  schema: 'cbh-clock/v1'; scope: string; generatedAt: string; expiresAt: string;
  timezone: 'Asia/Seoul'; targets: ClockAlarmTarget[];
  requiresDailySync: true; deviceApplied: false;
}

const DAY = 86_400_000;
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
function validDate(value: string): boolean {
  const at = Date.parse(value + 'T00:00:00Z');
  return /^20\d{2}-\d{2}-\d{2}$/.test(value) && Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value;
}

/** Untrusted text received by a native adapter must pass every check before
 * reading a mutation list. expectedScope is pinned at setup, not from input. */
export function validateClockAlarmPlan(value: unknown, now = new Date(), expectedScope?: string): ClockAlarmPlan {
  if (!value || typeof value !== 'object') throw new Error('INVALID_ALARM_PLAN');
  const plan = value as ClockAlarmPlan;
  const generated = Date.parse(plan.generatedAt), expires = Date.parse(plan.expiresAt);
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(generated) || !Number.isFinite(expires) ||
      expires <= now.getTime() || generated > now.getTime() || expires <= generated || expires - generated > 300_000)
    throw new Error('STALE_ALARM_PLAN');
  const scope = typeof plan.scope === 'string' ? /^CBH:[a-zA-Z0-9-]{8,64}:([^:]+):$/.exec(plan.scope) : null;
  if (plan.schema !== 'cbh-clock/v1' || plan.timezone !== 'Asia/Seoul' || !scope ||
      (expectedScope != null && plan.scope !== expectedScope) || plan.requiresDailySync !== true || plan.deviceApplied !== false ||
      !Array.isArray(plan.targets) || plan.targets.length > 48) throw new Error('INVALID_ALARM_PLAN');
  const labels = new Set<string>();
  for (const target of plan.targets) {
    if (!target || typeof target !== 'object') throw new Error('INVALID_ALARM_TARGET');
    const at = Date.parse(target.fireAt);
    if (!validDate(target.workDate) || !['START_MINUS_90', 'END_PLUS_30'].includes(target.kind) ||
        target.id !== `${scope[1]}:${target.workDate}:${target.kind}` || target.label !== plan.scope + target.id ||
        labels.has(target.label) || !Number.isFinite(at) || at % 60_000 !== 0 || at <= now.getTime() ||
        at >= generated + DAY || !CLOCK.test(target.clockTime) || target.clockTime !== seoulTime(new Date(at)))
      throw new Error('INVALID_ALARM_TARGET');
    const shiftDate = seoulDate(new Date(at + (target.kind === 'START_MINUS_90' ? 90 : -30) * 60_000));
    if (target.kind === 'START_MINUS_90' ? shiftDate !== target.workDate :
        shiftDate !== target.workDate && shiftDate !== seoulDate(new Date(Date.parse(target.workDate + 'T00:00:00+09:00') + DAY)))
      throw new Error('INVALID_ALARM_TARGET');
    labels.add(target.label);
  }
  return plan;
}

/** iOS Clock has time-of-day alarms, not arbitrary future-date alarms.
 * Only the next occurrence within 24 h is safe to materialize. */
export function buildClockAlarmPlan(entries: ScheduleEntry[], installationId: string, now = new Date(), personId?: string): ClockAlarmPlan {
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(installationId)) throw new Error('INVALID_ALARM_INSTALLATION');
  const people = [...new Set(entries.map(entry => entry.personId))];
  const owner = personId ?? people[0] ?? 'none';
  if (!owner || owner.length > 128 || !Number.isFinite(now.getTime())) throw new Error('INVALID_ALARM_OWNER');
  if (people.some(id => id !== owner)) throw new Error('MIXED_ALARM_OWNERS');
  const scope = `CBH:${installationId}:${encodeURIComponent(owner)}:`;
  const targets: ClockAlarmTarget[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry.enabled) continue;
    if (!validDate(entry.date) || !CLOCK.test(entry.start) || !CLOCK.test(entry.end) || entry.start === entry.end)
      throw new Error('INVALID_ALARM_SCHEDULE');
    const times = shiftTimes(entry);
    for (const [kind, at] of [['START_MINUS_90', times.start - 90 * 60_000], ['END_PLUS_30', times.end + 30 * 60_000]] as const) {
      if (!Number.isFinite(at) || at <= now.getTime() || at >= now.getTime() + 86_400_000) continue;
      const id = `${encodeURIComponent(entry.personId)}:${entry.date}:${kind}`;
      if (seen.has(id)) throw new Error('DUPLICATE_ALARM_TARGET');
      seen.add(id);
      const date = new Date(at);
      targets.push({ id, label: scope + id, fireAt: date.toISOString(), clockTime: seoulTime(date), workDate: entry.date, kind });
    }
  }
  targets.sort((a, b) => a.fireAt.localeCompare(b.fireAt) || a.id.localeCompare(b.id));
  return validateClockAlarmPlan({ schema: 'cbh-clock/v1', scope, generatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    timezone: 'Asia/Seoul', targets, requiresDailySync: true, deviceApplied: false }, now);
}

/** The shortcut must supply its own durable creation ledger. Prefix alone is
 * never ownership proof, and an empty result must never invoke Delete Alarms. */
export function reconcileOwnedAlarms(plan: ClockAlarmPlan, existing: { id: string; label: string; clockTime: string }[],
  owned: { id: string; label: string }[], now = new Date()) {
  validateClockAlarmPlan(plan, now);
  const remove: string[] = [];
  const keep = new Set<string>();
  for (const alarm of existing) {
    if (!alarm.label.startsWith(plan.scope) || !owned.some(item => item.id === alarm.id && item.label === alarm.label)) continue;
    const target = plan.targets.find(item => item.label === alarm.label && item.clockTime === alarm.clockTime);
    if (target && !keep.has(target.id)) keep.add(target.id);
    else remove.push(alarm.id);
  }
  return { removeIds: remove, create: plan.targets.filter(target => !keep.has(target.id)), neverDeleteAll: true as const };
}

export function clockShortcutUrl(plan: ClockAlarmPlan): string {
  return 'shortcuts://run-shortcut?name=' + encodeURIComponent('ComeBackHome 알람 동기화') + '&input=text&text=' + encodeURIComponent(JSON.stringify(plan));
}
export function alarmDisplayDate(iso: string): string { return seoulDate(new Date(iso)); }
