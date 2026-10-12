import type { ScheduleEntry } from '../../domain/models';
import { seoulDate, seoulTime, shiftTimes } from '../../domain/product-time';

export interface ClockAlarmTarget { id: string; label: string; fireAt: string; clockTime: string; workDate: string; kind: 'START_MINUS_90' | 'END_PLUS_30'; }
export interface ClockAlarmPlan {
  schema: 'cbh-clock/v1'; scope: string; generatedAt: string; expiresAt: string;
  timezone: 'Asia/Seoul'; targets: ClockAlarmTarget[];
  requiresDailySync: true; deviceApplied: false;
}

/** iOS Clock has time-of-day alarms, not arbitrary future-date alarms.
 * Only the next occurrence within 24 h is safe to materialize. */
export function buildClockAlarmPlan(entries: ScheduleEntry[], installationId: string, now = new Date(), personId?: string): ClockAlarmPlan {
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(installationId)) throw new Error('INVALID_ALARM_INSTALLATION');
  const people = [...new Set(entries.map(entry => entry.personId))];
  const owner = personId ?? people[0] ?? 'none';
  if (people.some(id => id !== owner)) throw new Error('MIXED_ALARM_OWNERS');
  const scope = `CBH:${installationId}:${encodeURIComponent(owner)}:`;
  const targets: ClockAlarmTarget[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry.enabled) continue;
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
  return { schema: 'cbh-clock/v1', scope, generatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    timezone: 'Asia/Seoul', targets, requiresDailySync: true, deviceApplied: false };
}

/** The shortcut must supply its own durable creation ledger. Prefix alone is
 * never ownership proof, and an empty result must never invoke Delete Alarms. */
export function reconcileOwnedAlarms(plan: ClockAlarmPlan, existing: { id: string; label: string; clockTime: string }[],
  owned: { id: string; label: string }[], now = new Date()) {
  const generated = Date.parse(plan.generatedAt), expires = Date.parse(plan.expiresAt);
  if (!Number.isFinite(generated) || !Number.isFinite(expires) || expires <= now.getTime() || generated > now.getTime()
    || expires - generated > 5 * 60_000 || plan.schema !== 'cbh-clock/v1' || plan.timezone !== 'Asia/Seoul') throw new Error('STALE_ALARM_PLAN');
  if (!/^CBH:[a-zA-Z0-9-]{8,64}:[^:]+:$/.test(plan.scope) || !Array.isArray(plan.targets)) throw new Error('INVALID_ALARM_PLAN');
  const labels = new Set<string>();
  for (const target of plan.targets) {
    const at = Date.parse(target.fireAt);
    if (!Number.isFinite(at) || at <= now.getTime() || at >= generated + 86_400_000
      || target.label !== plan.scope + target.id || labels.has(target.label)
      || target.clockTime !== seoulTime(new Date(at))) throw new Error('INVALID_ALARM_TARGET');
    labels.add(target.label);
  }
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
