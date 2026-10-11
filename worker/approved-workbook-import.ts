import type { D1DatabaseLike, D1PreparedStatementLike } from './runtime-types';
import { batchOrThrow, utcNow } from './repositories/d1-helpers';

// Dedicated to approved native XLSX imports. No OCR module or second backend.
type ExistingSnapshot = {
  enabled: boolean;
  start: string;
  end: string;
  breakMinutes: number | null;
};
type ImportPerson = {
  ref: string;
  kind: 'EXISTING' | 'PENDING_NEW';
  personId?: string;
  name?: string;
};
type ImportShift = {
  personRef: string;
  date: string;
  resolution: 'NEW' | 'SKIP' | 'KEEP';
  approved: true;
  enabled: boolean;
  explicitOff: boolean;
  start: string | null;
  end: string | null;
  breakMinutes: number | null;
  existing: ExistingSnapshot | null;
};
type Normalized = {
  requestId: string;
  approved: true;
  people: ImportPerson[];
  schedules: ImportShift[];
};

export class ApprovedWorkbookImportConflict extends Error {
  constructor(message: string) { super(message); this.name = 'ApprovedWorkbookImportConflict'; }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_APPROVED_IMPORT');
  }
  return value as Record<string, unknown>;
}
function string(value: unknown, field: string, max = 120): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error('INVALID_' + field);
  }
  return value.normalize('NFKC').trim();
}
function clock(value: unknown): string {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error('INVALID_IMPORT_CLOCK');
  }
  return value;
}
function date(value: unknown): string {
  const v = string(value, 'DATE', 10);
  const parsed = Date.parse(v + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(parsed) ||
      new Date(parsed).toISOString().slice(0, 10) !== v) throw new Error('INVALID_IMPORT_DATE');
  return v;
}
function minutes(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 720) {
    throw new Error('INVALID_BREAK_MINUTES');
  }
  return value;
}
function normalizeName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}
function snapshot(value: unknown): ExistingSnapshot | null {
  if (value === null) return null;
  const row = object(value);
  if (typeof row.enabled !== 'boolean') throw new Error('INVALID_EXPECTED_SCHEDULE');
  return {
    enabled: row.enabled,
    start: clock(row.start),
    end: clock(row.end),
    breakMinutes: minutes(row.breakMinutes),
  };
}

function normalize(value: unknown): Normalized {
  const body = object(value);
  const requestId = string(body.requestId, 'REQUEST_ID', 128);
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(requestId)) throw new Error('INVALID_REQUEST_ID');
  if (body.approved !== true) throw new Error('IMPORT_NOT_APPROVED');
  if (!Array.isArray(body.people) || !Array.isArray(body.schedules) ||
      body.people.length < 1 || body.people.length > 100 ||
      body.schedules.length < 1 || body.schedules.length > 700) {
    throw new Error('INVALID_IMPORT_SIZE');
  }
  const refs = new Set<string>();
  const newNames = new Set<string>();
  const people: ImportPerson[] = body.people.map((raw): ImportPerson => {
    const item = object(raw);
    const ref = string(item.ref, 'PERSON_REF');
    if (refs.has(ref)) throw new Error('DUPLICATE_PERSON_REF');
    refs.add(ref);
    if (item.kind === 'EXISTING') {
      return { ref, kind: 'EXISTING', personId: string(item.personId, 'PERSON_ID') };
    }
    if (item.kind !== 'PENDING_NEW') throw new Error('INVALID_PERSON_KIND');
    const name = string(item.name, 'PERSON_NAME', 50);
    if (!/^[\p{L}][\p{L}\p{M}\s·-]*$/u.test(name)) throw new Error('INVALID_PERSON_NAME');
    const key = normalizeName(name);
    if (newNames.has(key)) throw new Error('DUPLICATE_PERSON_NAME');
    newNames.add(key);
    return { ref, kind: 'PENDING_NEW', name };
  }).sort((a,b) => a.ref.localeCompare(b.ref));
  const keys = new Set<string>();
  const schedules: ImportShift[] = body.schedules.map((raw): ImportShift => {
    const item = object(raw);
    const personRef = string(item.personRef, 'PERSON_REF');
    if (!refs.has(personRef)) throw new Error('INVALID_PERSON_REF');
    const day = date(item.date);
    const key = personRef + '|' + day;
    if (keys.has(key)) throw new Error('DUPLICATE_PERSON_DATE');
    keys.add(key);
    if (!['NEW','SKIP','KEEP'].includes(String(item.resolution))) {
      throw new Error('IMPORT_UNREVIEWED_SCHEDULE');
    }
    if (item.approved !== true) throw new Error('IMPORT_UNREVIEWED_SCHEDULE');
    if (typeof item.enabled !== 'boolean' || typeof item.explicitOff !== 'boolean') {
      throw new Error('INVALID_IMPORT_STATE');
    }
    const enabled = item.enabled;
    if (!enabled && !item.explicitOff && item.resolution === 'NEW') {
      throw new Error('IMPORT_OFF_NOT_APPROVED');
    }
    // SKIP/KEEP can contain incomplete or empty source cells: they are
    // explicitly reviewed but never persisted. NEW work must be complete.
    const start = enabled && item.start != null ? clock(item.start) : null;
    const end = enabled && item.end != null ? clock(item.end) : null;
    if (item.resolution === 'NEW' && enabled && (!start || !end)) {
      throw new Error('IMPORT_INCOMPLETE_SCHEDULE');
    }
    if (!enabled && (item.start != null || item.end != null || item.breakMinutes != null)) {
      throw new Error('INVALID_OFF_PAYLOAD');
    }
    const breakMinutes = enabled ? minutes(item.breakMinutes) : null;
    if (!Object.prototype.hasOwnProperty.call(item, 'existing')) {
      throw new Error('MISSING_EXISTING_SNAPSHOT');
    }
    return {
      personRef, date: day, resolution: item.resolution as ImportShift['resolution'],
      approved: true, enabled, explicitOff: item.explicitOff,
      start, end, breakMinutes, existing: snapshot(item.existing),
    };
  }).sort((a,b) => (a.personRef+'|'+a.date).localeCompare(b.personRef+'|'+b.date));
  const selectedRefs = new Set(schedules.filter(s => s.resolution === 'NEW').map(s => s.personRef));
  for (const person of people) {
    if (person.kind === 'PENDING_NEW' && !selectedRefs.has(person.ref)) {
      throw new Error('PENDING_PERSON_HAS_NO_APPROVED_SCHEDULE');
    }
  }
  return { requestId, approved: true, people, schedules };
}

async function hexHash(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2,'0')).join('');
}
async function deterministicId(requestId: string, key: string): Promise<string> {
  const hex = await hexHash(requestId + ':' + key);
  // Stable ids only for attempted approved writes; no name-based identity keys.
  return hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+
    '-8'+hex.slice(17,20)+'-'+hex.slice(20,32);
}

interface ReceiptRow { payload_digest: string; receipt_json: string; }

export async function commitApprovedWorkbookImport(db: D1DatabaseLike, input: unknown): Promise<unknown> {
  const data = normalize(input);
  const digest = await hexHash(JSON.stringify({ people: data.people, schedules: data.schedules, approved: true }));
  const lookup = () => db.prepare(
    'SELECT payload_digest, receipt_json FROM approved_workbook_import_receipts WHERE request_id = ?1',
  ).bind(data.requestId).first<ReceiptRow>();
  const earlier = await lookup();
  if (earlier) {
    if (earlier.payload_digest !== digest) throw new ApprovedWorkbookImportConflict('IMPORT_REQUEST_ID_CONFLICT');
    return JSON.parse(earlier.receipt_json);
  }

  const existingPeople = await db.prepare('SELECT id, name FROM people').all<{id:string;name:string}>();
  const known = new Set(existingPeople.results.map(x=>x.id));
  const existingNames = new Set(existingPeople.results.map(x=>normalizeName(x.name)));
  const personIds = new Map<string,string>();
  for (const person of data.people) {
    if (person.kind === 'EXISTING') {
      if (!person.personId || !known.has(person.personId)) throw new Error('IMPORT_UNKNOWN_PERSON');
      personIds.set(person.ref, person.personId);
    } else {
      if (!person.name || existingNames.has(normalizeName(person.name))) {
        throw new ApprovedWorkbookImportConflict('DUPLICATE_PERSON_NAME');
      }
      personIds.set(person.ref, await deterministicId(data.requestId,'person:'+person.ref));
    }
  }
  const keys = new Set<string>();
  for (const row of data.schedules) {
    const personId = personIds.get(row.personRef)!;
    const key = personId + '|' + row.date;
    if (keys.has(key)) throw new Error('DUPLICATE_PERSON_DATE');
    keys.add(key);
  }

  const receipt = {
    requestId: data.requestId,
    people: data.people.map(person => ({
      ref: person.ref,
      personId: personIds.get(person.ref),
      created: person.kind === 'PENDING_NEW',
    })),
    schedules: data.schedules.filter(row=>row.resolution==='NEW')
      .map(row=>({ personRef:row.personRef, date:row.date, enabled:row.enabled })),
    applied: true,
  };
  const now = utcNow();
  const statements: D1PreparedStatementLike[] = [
    db.prepare(
      'INSERT INTO approved_workbook_import_receipts (request_id,payload_digest,receipt_json,created_at) '+
      'VALUES (?1,?2,?3,?4)',
    ).bind(data.requestId,digest,JSON.stringify(receipt),now),
  ];

  let ordinal=0;
  const assertion = (query: string, values: Array<string|number|null>) => {
    statements.push(db.prepare(
      'INSERT INTO approved_workbook_import_checks (request_id,ordinal,passed) '+
      'SELECT ?1,?2, CASE WHEN ('+query+') THEN 1 ELSE 0 END',
    ).bind(data.requestId,++ordinal,...values));
  };
  for (const person of data.people) {
    if (person.kind === 'EXISTING') {
      assertion('EXISTS (SELECT 1 FROM people WHERE id = ?3)',[person.personId!]);
    } else {
      // Both this check and the insert trigger reject duplicate employee creation.
      assertion("NOT EXISTS (SELECT 1 FROM people WHERE lower(replace(trim(name),' ','')) = lower(replace(trim(?3),' ','')))",[person.name!]);
      statements.push(db.prepare(
        'INSERT INTO people (id,name,relation,created_at,updated_at) VALUES (?1,?2,?3,?4,?4)',
      ).bind(personIds.get(person.ref)!,person.name!,'',now));
    }
  }
  for (const row of data.schedules) {
    if (row.resolution !== 'NEW') continue;
    const personId = personIds.get(row.personRef)!;
    if (row.existing) {
      assertion(
        'EXISTS (SELECT 1 FROM schedules WHERE person_id=?3 AND schedule_date=?4 '+
        'AND enabled=?5 AND start_time=?6 AND end_time=?7 AND break_minutes IS ?8)',
        [personId,row.date,row.existing.enabled?1:0,row.existing.start,row.existing.end,row.existing.breakMinutes],
      );
    } else {
      assertion('NOT EXISTS (SELECT 1 FROM schedules WHERE person_id=?3 AND schedule_date=?4)',
        [personId,row.date]);
    }
    const stableId = await deterministicId(data.requestId,
      'shift:'+row.personRef+':'+row.date);
    statements.push(db.prepare(
      'INSERT INTO schedules (id,person_id,schedule_date,enabled,start_time,end_time,break_minutes,created_at,updated_at) '+
      'VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8) '+
      'ON CONFLICT(person_id,schedule_date) DO UPDATE SET '+
      'enabled=excluded.enabled,start_time=excluded.start_time,end_time=excluded.end_time,'+
      'break_minutes=excluded.break_minutes,updated_at=excluded.updated_at',
    ).bind(stableId,personId,row.date,row.enabled?1:0,
      row.start??'00:00',row.end??'00:00',row.breakMinutes,now));
  }

  try {
    await batchOrThrow(db,statements);
  } catch(error) {
    // A concurrent retry with the same ID must receive the original receipt,
    // not mistake the ledger's unique constraint for a new write request.
    const winner = await lookup();
    if (winner) {
      if (winner.payload_digest !== digest) throw new ApprovedWorkbookImportConflict('IMPORT_REQUEST_ID_CONFLICT');
      return JSON.parse(winner.receipt_json);
    }
    throw error;
  }
  const persisted = await lookup();
  if (!persisted || persisted.payload_digest !== digest) {
    throw new Error('IMPORT_RECEIPT_MISSING');
  }
  return JSON.parse(persisted.receipt_json);
}
