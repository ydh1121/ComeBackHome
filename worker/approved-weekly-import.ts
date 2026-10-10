import type { ApprovedImportReceipt, ApprovedWeeklyImport } from '../src/application/contracts/repositories';
import type { ScheduleEntry } from '../src/domain/models';
import type { D1DatabaseLike } from './runtime-types';
import { D1PersonRepository } from './repositories/D1PersonRepository';
import { D1ScheduleRepository } from './repositories/D1ScheduleRepository';

function reject(message: string): never { throw new Error(message); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) reject(label + ' invalid');
  return value.trim();
}
function dateOf(value: unknown): Date {
  const raw = text(value, 'WEEK_START');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) reject('INVALID_WEEK_DATE');
  const date = new Date(raw + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw)
    reject('INVALID_WEEK_DATE');
  return date;
}
function normalized(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}
async function stableUuid(requestId: string, ref: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode('CBH-ATOMIC-IMPORT-v1\0' + requestId + '\0' + ref)));
  const hex = [...bytes.slice(0, 16)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-5' + hex.slice(13, 16) +
    '-a' + hex.slice(17, 20) + '-' + hex.slice(20, 32);
}

/** Runs only within the existing Pages Functions /api/schedules/import route.
 * No user image, production migration, background job or extra origin.
 */
export async function importApprovedWeekly(
  db: D1DatabaseLike,
  unknownRequest: unknown,
): Promise<ApprovedImportReceipt> {
  if (!isRecord(unknownRequest)) reject('APPROVED_WEEKLY_IMPORT_REQUIRED');
  const requestId = text(unknownRequest.requestId, 'requestId');
  if (!/^[\da-f-]{36}$/i.test(requestId)) reject('INVALID_IMPORT_REQUEST_ID');
  if (unknownRequest.confirmed !== true) reject('WEEKLY_DATES_NOT_CONFIRMED');
  const monday = dateOf(unknownRequest.weekStart);
  if (monday.getUTCDay() !== 1) reject('WEEK_START_MUST_BE_MONDAY');
  const weekStart = monday.toISOString().slice(0, 10);
  const peopleRaw = unknownRequest.newPeople;
  const raw = unknownRequest.schedules;
  if (!Array.isArray(peopleRaw) || peopleRaw.length > 80 ||
      !Array.isArray(raw) || raw.length < 1 || raw.length > 700)
    reject('INVALID_APPROVED_WEEKLY_IMPORT_SIZE');

  const existing = await new D1PersonRepository(db).list();
  const existingIds = new Map(existing.map(person => [person.id, person]));
  const existingNames = new Map(existing.map(person => [normalized(person.name), person.id]));
  const proposed = new Map<string, { id: string; name: string }>();
  const createdNames = new Set<string>();
  for (const item of peopleRaw) {
    if (!isRecord(item)) reject('INVALID_NEW_PERSON');
    const ref = text(item.ref, 'pendingPersonRef');
    if (!/^[\da-f-]{36}$/i.test(ref) || proposed.has(ref)) reject('DUPLICATE_NEW_PERSON_REF');
    const name = text(item.name, 'new person name').normalize('NFKC');
    if (!/^[가-힣]{2,5}$/.test(name)) reject('INVALID_NEW_PERSON_NAME');
    const nameKey = normalized(name);
    if (createdNames.has(nameKey)) reject('DUPLICATE_NEW_PERSON_NAME');
    createdNames.add(nameKey);
    const id = await stableUuid(requestId, ref);
    const found = existingIds.get(id);
    if (found && (found.name !== name || found.relation !== ''))
      reject('IMPORT_RETRY_PERSON_MISMATCH');
    const matchingId = existingNames.get(nameKey);
    if (matchingId && matchingId !== id) reject('NEW_PERSON_NAME_ALREADY_EXISTS');
    proposed.set(ref, { id, name });
  }
  const keys = new Set<string>();
  const rowIds = new Set<string>();
  const referencedNewPeople = new Set<string>();
  const schedules: ScheduleEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item) || item.approved !== true || item.decision !== 'NEW')
      reject('UNAPPROVED_IMPORT_SCHEDULE');
    const date = dateOf(item.date).toISOString().slice(0, 10);
    const dayIndex = item.dayIndex;
    if (!Number.isInteger(dayIndex) || (dayIndex as number) < 0 || (dayIndex as number) > 6 ||
        date !== new Date(monday.getTime() + (dayIndex as number) * 86400000)
          .toISOString().slice(0, 10)) reject('UNCONFIRMED_WEEKLY_DAY');
    const hasExisting = typeof item.personId === 'string' && !!item.personId;
    const hasPending = typeof item.pendingPersonRef === 'string' && !!item.pendingPersonRef;
    if (hasExisting === hasPending) reject('IMPORT_PERSON_REFERENCE_AMBIGUOUS');
    let personId: string;
    if (hasPending) {
      const ref = text(item.pendingPersonRef, 'pendingPersonRef');
      const person = proposed.get(ref);
      if (!person) reject('IMPORT_UNKNOWN_PENDING_PERSON');
      referencedNewPeople.add(ref);
      personId = person.id;
    } else {
      personId = text(item.personId, 'schedule.personId');
      if (!existingIds.has(personId)) reject('Import references unknown person.');
    }
    const id = text(item.id, 'schedule.id');
    if (rowIds.has(id)) reject('DUPLICATE_IMPORT_SCHEDULE_ID');
    rowIds.add(id);
    const key = personId + '|' + date;
    if (keys.has(key)) reject('Duplicate person/date in import batch.');
    keys.add(key);
    if (typeof item.enabled !== 'boolean') reject('INVALID_IMPORT_ENABLED');
    const start = text(item.start, 'start');
    const end = text(item.end, 'end');
    if (![start, end].every(value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)))
      reject('Import schedule clock is invalid.');
    const rest = item.breakMinutes;
    if (rest !== undefined && rest !== null &&
        (!Number.isInteger(rest) || (rest as number) < 0 || (rest as number) > 720))
      reject('INVALID_BREAK_MINUTES');
    if (item.breakReviewRequired === true && item.enabled && rest == null)
      reject('UNREVIEWED_BREAK_MINUTES');
    if (item.recognitionState === 'OFF_CANDIDATE' && item.enabled === false &&
        item.offApproved !== true) reject('UNAPPROVED_OFF_CANDIDATE');
    schedules.push({ id, personId, date, enabled: item.enabled,
      start, end, ...(rest !== undefined ? { breakMinutes: rest as number | null } : {}) });
  }
  if ([...proposed.keys()].some(ref => !referencedNewPeople.has(ref)))
    reject('UNUSED_PENDING_PERSON');
  const newPeople = [...proposed.values()];
  await new D1ScheduleRepository(db).upsertApprovedWithPeople(newPeople, schedules);
  return {
    createdPeople: Object.fromEntries([...proposed].map(([ref, person]) => [ref, person.id])),
    schedules,
  };
}
