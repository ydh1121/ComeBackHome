import { validateClockAlarmPlan, type ClockAlarmTarget } from './alarm-plan';

/** Clock handles are supplied by Find Alarm at run time, never invented UUIDs. */
export interface DeviceClockAlarm { handle: string; label: string; clockTime: string; enabled: boolean; repeating: boolean; }
export interface ClockReceipt { targetId: string; label: string; clockTime: string; fireAt: string; }
export interface ClockLedger {
  schema: 'cbh-clock-ledger/v1'; scope: string;
  receipts: ClockReceipt[];
  pending: null | { operation: 'CREATE' | 'DELETE'; label: string };
}
export interface ClockOperations {
  create: ClockAlarmTarget[]; remove: DeviceClockAlarm[]; enable: DeviceClockAlarm[];
  retained: ClockReceipt[]; confirmationRequired: true; deviceApplied: false;
}

/** Pure executable reference for the native action recipe. It never accesses
 * Clock or stores a file. A ledger is local to one phone, not iCloud-shared. */
export function prepareClockReceiver(input: unknown, ledger: ClockLedger, alarms: DeviceClockAlarm[],
  options: { now: Date; expectedScope: string; deviceUtcOffset: string }): ClockOperations {
  const plan = validateClockAlarmPlan(input, options.now, options.expectedScope);
  if (options.deviceUtcOffset !== '+0900') throw new Error('DEVICE_TIMEZONE_MISMATCH');
  if (ledger.schema !== 'cbh-clock-ledger/v1' || ledger.scope !== options.expectedScope || !Array.isArray(ledger.receipts) ||
      ledger.receipts.length > 48 || ledger.pending !== null) throw new Error('LEDGER_REVIEW_REQUIRED');
  if (new Set(alarms.map(a => a.handle)).size !== alarms.length) throw new Error('AMBIGUOUS_ALARM_HANDLE');
  const recorded = new Set<string>();
  const remove: DeviceClockAlarm[] = [], enable: DeviceClockAlarm[] = [], retained: ClockReceipt[] = [];
  const create: ClockAlarmTarget[] = [];
  for (const receipt of ledger.receipts) {
    if (!receipt || typeof receipt.label !== 'string' || receipt.label !== ledger.scope + receipt.targetId ||
        recorded.has(receipt.label) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(receipt.clockTime) || !Number.isFinite(Date.parse(receipt.fireAt)))
      throw new Error('INVALID_CLOCK_RECEIPT');
    recorded.add(receipt.label);
    const found = alarms.filter(a => a.label === receipt.label);
    if (found.length > 1) throw new Error('AMBIGUOUS_OWNED_ALARM');
    if (!found.length) continue; // User removed this receipt's alarm; no delete-all.
    const alarm = found[0];
    if (alarm.clockTime !== receipt.clockTime || alarm.repeating) throw new Error('OWNED_ALARM_CHANGED_OUTSIDE_APP');
    const target = plan.targets.find(t => t.label === receipt.label && t.clockTime === receipt.clockTime && t.fireAt === receipt.fireAt);
    if (!target) remove.push(alarm);
    else { retained.push(receipt); if (!alarm.enabled) enable.push(alarm); }
  }
  for (const target of plan.targets) {
    const found = alarms.filter(a => a.label === target.label);
    if (found.length && !recorded.has(target.label)) throw new Error('UNOWNED_TARGET_LABEL_COLLISION');
    if (!retained.some(r => r.label === target.label)) create.push(target);
  }
  return { create, remove, enable, retained, confirmationRequired: true, deviceApplied: false };
}

/** Save pending before the Clock action; save the returned receipt only after
 * Find Alarm confirms the result. Interrupted actions require owner inspection. */
export function recordClockCreation(ledger: ClockLedger, target: ClockAlarmTarget, observed: DeviceClockAlarm[]): ClockLedger {
  if (ledger.pending?.operation !== 'CREATE' || ledger.pending.label !== target.label || target.label !== ledger.scope + target.id)
    throw new Error('CREATION_NOT_JOURNALED');
  const match = observed.filter(a => a.label === target.label);
  if (match.length !== 1 || match[0].clockTime !== target.clockTime || !match[0].enabled || match[0].repeating)
    throw new Error('CLOCK_CREATION_NOT_CONFIRMED');
  return { ...ledger, pending: null, receipts: [...ledger.receipts.filter(r => r.label !== target.label),
    { targetId: target.id, label: target.label, clockTime: target.clockTime, fireAt: target.fireAt }] };
}
