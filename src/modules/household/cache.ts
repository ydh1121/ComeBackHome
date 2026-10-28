import { clearCardArtCache } from "./card-art-cache";
import type { HouseholdResponse } from "./client";
import { MAX_WON, parseCardInput, parseEntryInput, parseHouseholdInstant, parseHouseholdPreferences, parsePlanInput, parseTodoInput } from './domain/model';

export type CacheValue = { savedAt: number; value: HouseholdResponse };
const CACHE_PREFIX = 'cbh.household.cache.';
const CACHE_SETTING = 'cbh.household.cache-enabled';
const MAX_CACHE_AGE = 24 * 60 * 60 * 1000;
const MAX_STORED_CHARACTERS = 2 * 1024 * 1024;
const memory = new Map<string, CacheValue>();
let enabledWithoutStorage = true;
let sessionChoice: boolean | null = null;
let pendingStoragePurge = false;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
function purgeStoredCopies(): boolean {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(CACHE_PREFIX)) localStorage.removeItem(key);
    return true;
  } catch { return false; }
}
export function householdCacheEnabled() {
  if (sessionChoice !== null) return sessionChoice;
  try { enabledWithoutStorage = localStorage.getItem(CACHE_SETTING) !== 'false'; } catch { /* A blocked store does not prevent memory caching or server reads. */ }
  return enabledWithoutStorage;
}
export function clearHouseholdCache() {
  clearCardArtCache();
  memory.clear();
  pendingStoragePurge = !purgeStoredCopies();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('cbh-household-cache-cleared'));
}
export function setHouseholdCacheEnabled(enabled: boolean) {
  sessionChoice = enabled;
  enabledWithoutStorage = enabled;
  try { localStorage.setItem(CACHE_SETTING, String(enabled)); } catch { /* Keep this session's choice when storage is blocked. */ }
  if (!enabled) clearHouseholdCache();
}
function audit(value: Record<string, unknown>): boolean {
  if (!validId(value.createdBy) || !validId(value.updatedBy)) return false;
  parseHouseholdInstant(value.createdAt); parseHouseholdInstant(value.updatedAt);
  return true;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** A cache never proves authorization; AuthRoot must verify the current session first.
 * Reject malformed/old snapshots before a component can calculate or render them. */
export function validHouseholdCacheResponse(value: unknown): value is HouseholdResponse {
  if (!record(value) || value.ready !== true || typeof value.connected !== 'boolean' || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) return false;
  if (value.spreadsheetUrl !== null && (typeof value.spreadsheetUrl !== 'string' || !/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+\/edit$/.test(value.spreadsheetUrl))) return false;
  if (value.pending !== undefined && typeof value.pending !== 'boolean') return false;
  const s = value.snapshot;
  if (!record(s) || s.schemaVersion !== 1 || s.revision !== value.revision || !(s.lastCommandId === null || validId(s.lastCommandId)) || !(s.lastCommandPayload === null || typeof s.lastCommandPayload === 'string' && s.lastCommandPayload.length <= 65536)) return false;
  if (!Array.isArray(s.cards) || s.cards.length > 100 || !Array.isArray(s.entries) || s.entries.length > 50000 || !Array.isArray(s.plans) || s.plans.length > 50000 || !Array.isArray(s.todos) || s.todos.length > 50000) return false;
  try {
    parseHouseholdPreferences(s.preferences);
    const allIds = (rows: unknown[]) => new Set(rows.map(item => record(item) ? item.id : null)).size === rows.length;
    if (![s.cards, s.entries, s.plans, s.todos].every(allIds)) return false;
    for (const c of s.cards) {
      if (!record(c) || !audit(c) || !Number.isSafeInteger(c.initialLimit) || (c.initialLimit as number) < 0 || (c.initialLimit as number) > MAX_WON) return false;
      parseCardInput({ id:c.id,name:c.name,kind:c.kind,balanceMode:c.balanceMode,limit:c.limit,openingRemaining:c.openingRemaining,orientation:c.orientation,imageFileId:c.imageFileId,archived:c.archived });
    }
    const cards = new Set(s.cards.map(c => c.id));
    let grossRecorded = 0;
    for (const e of s.entries) {
      if (!record(e) || !audit(e)) return false;
      parseEntryInput({ id:e.id,kind:e.kind,amount:e.amount,occurredAt:e.occurredAt,merchant:e.merchant,category:e.category,subcategory:e.subcategory,note:e.note,cardId:e.cardId,toCardId:e.toCardId,repaymentSourceCardId:e.repaymentSourceCardId,incomeType:e.incomeType });
      if ([e.cardId, e.toCardId, e.repaymentSourceCardId].some(id => id != null && !cards.has(id))) return false;
      if (e.voidedAt !== null) { parseHouseholdInstant(e.voidedAt); if (!validId(e.voidedBy)) return false; }
      else { if (e.voidedBy !== null) return false; grossRecorded += e.amount as number; if (!Number.isSafeInteger(grossRecorded)) return false; }
    }
    for (const p of s.plans) {
      if (!record(p) || !audit(p)) return false;
      parsePlanInput({ id:p.id,month:p.month,plannedIncome:p.plannedIncome,allocations:p.allocations });
    }
    if (new Set(s.plans.map(p => p.month)).size !== s.plans.length) return false;
    for (const t of s.todos) {
      if (!record(t) || !audit(t)) return false;
      parseTodoInput({ id:t.id,text:t.text,dueAt:t.dueAt,remind:t.remind,reminderRecipient:t.reminderRecipient });
      if (t.completedAt !== null) { parseHouseholdInstant(t.completedAt); if (!validId(t.completedBy)) return false; }
      else if (t.completedBy !== null) return false;
      if (t.archivedAt != null) { parseHouseholdInstant(t.archivedAt); if (!validId(t.archivedBy) || t.completedAt === null) return false; }
      else if (t.archivedBy != null) return false;
    }
    return true;
  } catch { return false; }
}
function fresh(value: CacheValue): boolean { const age = new Date().getTime() - value.savedAt; return Number.isSafeInteger(value.savedAt) && age >= 0 && age < MAX_CACHE_AGE; }
export function readCache(userId: string): CacheValue | null {
  if (!validId(userId) || !householdCacheEnabled()) return null;
  if (pendingStoragePurge) { pendingStoragePurge = !purgeStoredCopies(); if (pendingStoragePurge) return null; }
  const existing = memory.get(userId);
  if (existing && fresh(existing)) return existing;
  memory.delete(userId);
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + userId);
    const value = raw && raw.length <= MAX_STORED_CHARACTERS ? JSON.parse(raw) as CacheValue | null : null;
    if (value && fresh(value) && validHouseholdCacheResponse(value.value)) { memory.set(userId, value); return value; }
    localStorage.removeItem(CACHE_PREFIX + userId);
  } catch { try { localStorage.removeItem(CACHE_PREFIX + userId); } catch { /* A blocked store never blocks the server read. */ } }
  return null;
}
export function writeCache(userId: string, value: HouseholdResponse) {
  if (!validId(userId) || !householdCacheEnabled() || !validHouseholdCacheResponse(value)) return;
  if (pendingStoragePurge) pendingStoragePurge = !purgeStoredCopies();
  const item = { savedAt: new Date().getTime(), value };
  memory.set(userId, item);
  try {
    const serialized = JSON.stringify(item);
    if (serialized.length <= MAX_STORED_CHARACTERS && !pendingStoragePurge) localStorage.setItem(CACHE_PREFIX + userId, serialized);
    else localStorage.removeItem(CACHE_PREFIX + userId);
  } catch { /* Storage may be full or disabled; the server has the confirmed copy. */ }
}
