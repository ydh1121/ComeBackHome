/** Shared household records. No provider, session, UI or schedule dependencies. */
export const HOUSEHOLD_SCHEMA_VERSION = 1 as const;
export const MAX_WON = 1_000_000_000_000;
export type CardKind = 'debit' | 'credit' | 'mobile';
export type EntryKind = 'expense' | 'income' | 'refund' | 'repayment' | 'borrowing' | 'transfer';
export interface CardInput {
  id: string;
  name: string;
  kind: CardKind;
  /** Mobile cards may be prepaid or credit products; the owner chooses. */
  balanceMode?: 'credit' | 'balance';
  /** For debit cards this is the opening funded amount, not a credit facility. */
  limit: number;
  openingRemaining: number;
  orientation: 'landscape' | 'portrait';
  imageFileId?: string | null;
  archived?: boolean;
}
export interface EntryInput {
  id: string;
  kind: EntryKind;
  amount: number;
  occurredAt: string;
  merchant?: string;
  category?: string;
  subcategory?: string;
  note?: string;
  cardId?: string | null;
  toCardId?: string | null;
  /** An atomic repayment funded by a different credit/mobile card. */
  repaymentSourceCardId?: string | null;
  incomeType?: 'salary' | 'other';
}
export interface PlanInput {
  id: string;
  month: string;
  plannedIncome: number;
  allocations: Array<{ id: string; label: string; amount: number }>;
}
export interface TodoInput { id: string; text: string; dueAt: string | null; remind: boolean }
export interface HouseholdPreferences { dailyLedgerReminder: boolean; todoReminders: boolean }
interface Audit { createdAt: string; createdBy: string; updatedAt: string; updatedBy: string }
export interface HouseholdCard extends CardInput, Audit { initialLimit: number }
export interface HouseholdEntry extends EntryInput, Audit { voidedAt: string | null; voidedBy: string | null }
export interface SalaryPlan extends PlanInput, Audit {}
export interface HouseholdTodo extends TodoInput, Audit { completedAt: string | null; completedBy: string | null }
export interface HouseholdState {
  schemaVersion: typeof HOUSEHOLD_SCHEMA_VERSION;
  revision: number;
  cards: HouseholdCard[];
  entries: HouseholdEntry[];
  plans: SalaryPlan[];
  todos: HouseholdTodo[];
  preferences: HouseholdPreferences;
  lastCommandId: string | null;
  /** Bounded last-command identity, for exact retry recognition. Stored privately with the snapshot. */
  lastCommandPayload: string | null;
}
export type HouseholdEvent =
  | { type: 'card.save'; card: CardInput }
  | { type: 'entry.add'; entry: EntryInput }
  | { type: 'entry.correct'; id: string; replacement: EntryInput }
  | { type: 'entry.void'; id: string }
  | { type: 'plan.save'; plan: PlanInput }
  | { type: 'todo.save'; todo: TodoInput }
  | { type: 'todo.complete'; id: string; done: boolean }
  | { type: 'preferences.save'; preferences: HouseholdPreferences };
export interface HouseholdCommand { id: string; expectedRevision: number; event: HouseholdEvent }
export type HouseholdErrorCode = 'INVALID_INPUT' | 'REVISION_CONFLICT' | 'NOT_FOUND' | 'DUPLICATE_ID' | 'CARD_IN_USE' | 'CARD_ARCHIVED' | 'INVALID_CARD_OPERATION';
export class HouseholdError extends Error {
  constructor(public readonly code: HouseholdErrorCode, public readonly field?: string) { super(code); this.name = 'HouseholdError'; }
}
const fail = (field: string): never => { throw new HouseholdError('INVALID_INPUT', field); };
function object(value: unknown, allowed: readonly string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(field);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !allowed.includes(key))) return fail(field);
  return record;
}
function string(value: unknown, field: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return fail(field);
  const clean = value.trim();
  if (!allowEmpty && !clean) return fail(field);
  return clean;
}
function id(value: unknown, field = 'id'): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) return fail(field);
  return value;
}
function money(value: unknown, field: string, allowZero = true): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > MAX_WON) return fail(field);
  return value;
}
function boolean(value: unknown, field: string): boolean { if (typeof value !== 'boolean') return fail(field); return value; }
function option<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) return fail(field);
  return value as T;
}
export function validHouseholdDate(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{3}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
export function parseHouseholdInstant(value: unknown, field = 'occurredAt'): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !validHouseholdDate(value.slice(0, 10))) return fail(field);
  const time = value.slice(11).match(/^(\d{2}):(\d{2})(?::(\d{2}))?/)!;
  if (+time[1] > 23 || +time[2] > 59 || +(time[3] ?? 0) > 59 || !Number.isFinite(Date.parse(value))) return fail(field);
  return new Date(value).toISOString();
}
export function parseCardInput(value: unknown): CardInput {
  const v = object(value, ['id', 'name', 'kind', 'balanceMode', 'limit', 'openingRemaining', 'orientation', 'imageFileId', 'archived'], 'card');
  const limit = money(v.limit, 'limit'), openingRemaining = money(v.openingRemaining, 'openingRemaining');
  const kind = option(v.kind, ['debit', 'credit', 'mobile'], 'kind');
  const balanceMode = v.balanceMode === undefined ? kind === 'credit' ? 'credit' : 'balance' : option(v.balanceMode, ['credit', 'balance'], 'balanceMode');
  if (kind === 'credit' && balanceMode !== 'credit' || kind === 'debit' && balanceMode !== 'balance') return fail('balanceMode');
  return { id: id(v.id), name: string(v.name, 'name', 80), kind, balanceMode, limit, openingRemaining,
    orientation: option(v.orientation, ['landscape', 'portrait'], 'orientation'), imageFileId: v.imageFileId == null ? null : id(v.imageFileId, 'imageFileId'), archived: v.archived === undefined ? false : boolean(v.archived, 'archived') };
}
export function parseEntryInput(value: unknown): EntryInput {
  const v = object(value, ['id', 'kind', 'amount', 'occurredAt', 'merchant', 'category', 'subcategory', 'note', 'cardId', 'toCardId', 'repaymentSourceCardId', 'incomeType'], 'entry');
  const kind = option(v.kind, ['expense', 'income', 'refund', 'repayment', 'borrowing', 'transfer'], 'kind');
  const result: EntryInput = { id: id(v.id), kind, amount: money(v.amount, 'amount', false), occurredAt: parseHouseholdInstant(v.occurredAt),
    merchant: v.merchant === undefined ? '' : string(v.merchant, 'merchant', 120, true), category: v.category === undefined ? '' : string(v.category, 'category', 80, true),
    subcategory: v.subcategory === undefined ? '' : string(v.subcategory, 'subcategory', 100, true), note: v.note === undefined ? '' : string(v.note, 'note', 2000, true),
    cardId: v.cardId == null ? null : id(v.cardId, 'cardId'), toCardId: v.toCardId == null ? null : id(v.toCardId, 'toCardId'),
    repaymentSourceCardId: v.repaymentSourceCardId == null ? null : id(v.repaymentSourceCardId, 'repaymentSourceCardId') };
  if (v.incomeType !== undefined) result.incomeType = option(v.incomeType, ['salary', 'other'] as const, 'incomeType');
  if ((kind === 'repayment' || kind === 'borrowing') && !result.cardId) return fail('cardId');
  if (result.incomeType && kind !== 'income') return fail('incomeType');
  if (result.toCardId && kind !== 'transfer') return fail('toCardId');
  if (kind === 'transfer' && (!result.cardId && !result.toCardId || result.cardId === result.toCardId)) return fail('toCardId');
  if (result.repaymentSourceCardId && (kind !== 'repayment' || result.repaymentSourceCardId === result.cardId)) return fail('repaymentSourceCardId');
  return result;
}
export function parsePlanInput(value: unknown): PlanInput {
  const v = object(value, ['id', 'month', 'plannedIncome', 'allocations'], 'plan');
  if (typeof v.month !== 'string' || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(v.month)) return fail('month');
  if (!Array.isArray(v.allocations) || v.allocations.length > 30) return fail('allocations');
  const allocations = v.allocations.map(item => { const a = object(item, ['id', 'label', 'amount'], 'allocation'); return { id: id(a.id), label: string(a.label, 'label', 80), amount: money(a.amount, 'amount') }; });
  if (new Set(allocations.map(a => a.id)).size !== allocations.length) return fail('allocations');
  if (allocations.reduce((sum, a) => sum + a.amount, 0) > MAX_WON) return fail('allocations');
  return { id: id(v.id), month: v.month, plannedIncome: money(v.plannedIncome, 'plannedIncome'), allocations };
}
export function parseTodoInput(value: unknown): TodoInput {
  const v = object(value, ['id', 'text', 'dueAt', 'remind'], 'todo');
  const dueAt = v.dueAt === null ? null : parseHouseholdInstant(v.dueAt, 'dueAt'), remind = boolean(v.remind, 'remind');
  if (remind && !dueAt) return fail('dueAt');
  return { id: id(v.id), text: string(v.text, 'text', 4000), dueAt, remind };
}
export function parseHouseholdPreferences(value: unknown): HouseholdPreferences {
  const v = object(value, ['dailyLedgerReminder', 'todoReminders'], 'preferences');
  return { dailyLedgerReminder: boolean(v.dailyLedgerReminder, 'dailyLedgerReminder'), todoReminders: boolean(v.todoReminders, 'todoReminders') };
}
export function parseHouseholdEvent(value: unknown): HouseholdEvent {
  if (!value || typeof value !== 'object') return fail('event');
  const type = (value as Record<string, unknown>).type;
  if (type === 'card.save') { const v = object(value, ['type', 'card'], 'event'); return { type, card: parseCardInput(v.card) }; }
  if (type === 'entry.add') { const v = object(value, ['type', 'entry'], 'event'); return { type, entry: parseEntryInput(v.entry) }; }
  if (type === 'entry.correct') { const v = object(value, ['type', 'id', 'replacement'], 'event'); return { type, id: id(v.id), replacement: parseEntryInput(v.replacement) }; }
  if (type === 'entry.void') { const v = object(value, ['type', 'id'], 'event'); return { type, id: id(v.id) }; }
  if (type === 'plan.save') { const v = object(value, ['type', 'plan'], 'event'); return { type, plan: parsePlanInput(v.plan) }; }
  if (type === 'todo.save') { const v = object(value, ['type', 'todo'], 'event'); return { type, todo: parseTodoInput(v.todo) }; }
  if (type === 'todo.complete') { const v = object(value, ['type', 'id', 'done'], 'event'); return { type, id: id(v.id), done: boolean(v.done, 'done') }; }
  if (type === 'preferences.save') { const v = object(value, ['type', 'preferences'], 'event'); return { type, preferences: parseHouseholdPreferences(v.preferences) }; }
  return fail('event.type');
}
export function parseHouseholdCommand(value: unknown): HouseholdCommand {
  const v = object(value, ['id', 'expectedRevision', 'event'], 'command');
  if (typeof v.expectedRevision !== 'number' || !Number.isSafeInteger(v.expectedRevision) || v.expectedRevision < 0) return fail('expectedRevision');
  return { id: id(v.id), expectedRevision: v.expectedRevision, event: parseHouseholdEvent(v.event) };
}
export function createHouseholdState(): HouseholdState {
  return { schemaVersion: 1, revision: 0, cards: [], entries: [], plans: [], todos: [], preferences: { dailyLedgerReminder: false, todoReminders: true }, lastCommandId: null, lastCommandPayload: null };
}
export function cardUsesCredit(card: Pick<CardInput, 'kind' | 'balanceMode'>): boolean { return card.balanceMode === 'credit' || card.balanceMode === undefined && card.kind === 'credit'; }
function requireCard(state: HouseholdState, cardId: string, allowArchived = false): HouseholdCard {
  const card = state.cards.find(item => item.id === cardId);
  if (!card) throw new HouseholdError('NOT_FOUND', 'cardId');
  if (card.archived && !allowArchived) throw new HouseholdError('CARD_ARCHIVED', 'cardId');
  return card;
}
function validateEntryCards(state: HouseholdState, entry: EntryInput): void {
  const card = entry.cardId ? requireCard(state, entry.cardId) : null;
  const destination = entry.toCardId ? requireCard(state, entry.toCardId) : null;
  const source = entry.repaymentSourceCardId ? requireCard(state, entry.repaymentSourceCardId) : null;
  if (['repayment', 'borrowing'].includes(entry.kind) && card && !cardUsesCredit(card)) throw new HouseholdError('INVALID_CARD_OPERATION');
  if (source && !cardUsesCredit(source)) throw new HouseholdError('INVALID_CARD_OPERATION');
  if (entry.kind === 'income' && card && cardUsesCredit(card)) throw new HouseholdError('INVALID_CARD_OPERATION');
  if (entry.kind === 'transfer' && (card && cardUsesCredit(card) || destination && cardUsesCredit(destination))) throw new HouseholdError('INVALID_CARD_OPERATION');
}
/** Pure transition. Servers must serialize writes and retain event IDs for historical retry deduplication. */
export function applyHouseholdCommand(state: HouseholdState, raw: HouseholdCommand, actorId: string, nowIso: string): HouseholdState {
  const command = parseHouseholdCommand(raw), actor = id(actorId, 'actorId'), now = parseHouseholdInstant(nowIso, 'now');
  // Only the exact immediately previous revision may acknowledge a retry. Older IDs require the server journal.
  if (command.id === state.lastCommandId && command.expectedRevision === state.revision - 1) {
    if (state.lastCommandPayload !== JSON.stringify(command)) throw new HouseholdError('DUPLICATE_ID');
    return state;
  }
  if (command.expectedRevision !== state.revision) throw new HouseholdError('REVISION_CONFLICT');
  if (command.id === state.lastCommandId) throw new HouseholdError('DUPLICATE_ID');
  const event = command.event;
  const result: HouseholdState = { ...state, revision: state.revision + 1, lastCommandId: command.id, lastCommandPayload: JSON.stringify(command) };
  const audit = (previous?: Audit): Audit => ({ createdAt: previous?.createdAt ?? now, createdBy: previous?.createdBy ?? actor, updatedAt: now, updatedBy: actor });
  if (event.type === 'card.save') {
    const previous = state.cards.find(card => card.id === event.card.id);
    if (!previous && state.cards.length >= 100) return fail('cards');
    const hasEntries = previous && state.entries.some(entry => entry.cardId === previous.id || entry.toCardId === previous.id || entry.repaymentSourceCardId === previous.id);
    if (!hasEntries && event.card.openingRemaining > event.card.limit) return fail('openingRemaining');
    if (hasEntries && (event.card.kind !== previous.kind || cardUsesCredit(event.card) !== cardUsesCredit(previous) || event.card.openingRemaining !== previous.openingRemaining || !cardUsesCredit(previous) && event.card.limit !== previous.limit)) throw new HouseholdError('CARD_IN_USE');
    const card = { ...event.card, initialLimit: hasEntries ? previous.initialLimit : event.card.limit, ...audit(previous) };
    result.cards = previous ? state.cards.map(item => item.id === card.id ? card : item) : [...state.cards, card];
  } else if (event.type === 'entry.add') {
    if (state.entries.some(entry => entry.id === event.entry.id)) throw new HouseholdError('DUPLICATE_ID');
    validateEntryCards(state, event.entry);
    result.entries = [...state.entries, { ...event.entry, ...audit(), voidedAt: null, voidedBy: null }];
  } else if (event.type === 'entry.void') {
    if (!state.entries.some(entry => entry.id === event.id && !entry.voidedAt)) throw new HouseholdError('NOT_FOUND');
    result.entries = state.entries.map(entry => entry.id === event.id ? { ...entry, ...audit(entry), voidedAt: now, voidedBy: actor } : entry);
  } else if (event.type === 'entry.correct') {
    if (!state.entries.some(entry => entry.id === event.id && !entry.voidedAt)) throw new HouseholdError('NOT_FOUND');
    if (state.entries.some(entry => entry.id === event.replacement.id)) throw new HouseholdError('DUPLICATE_ID');
    validateEntryCards(state, event.replacement);
    result.entries = [...state.entries.map(entry => entry.id === event.id ? { ...entry, ...audit(entry), voidedAt: now, voidedBy: actor } : entry), { ...event.replacement, ...audit(), voidedAt: null, voidedBy: null }];
  } else if (event.type === 'plan.save') {
    const previous = state.plans.find(plan => plan.id === event.plan.id);
    if (state.plans.some(plan => plan.month === event.plan.month && plan.id !== event.plan.id)) throw new HouseholdError('DUPLICATE_ID', 'month');
    const plan = { ...event.plan, ...audit(previous) };
    result.plans = previous ? state.plans.map(item => item.id === plan.id ? plan : item) : [...state.plans, plan];
  } else if (event.type === 'todo.save') {
    const previous = state.todos.find(todo => todo.id === event.todo.id);
    const todo = { ...event.todo, ...audit(previous), completedAt: previous?.completedAt ?? null, completedBy: previous?.completedBy ?? null };
    result.todos = previous ? state.todos.map(item => item.id === todo.id ? todo : item) : [...state.todos, todo];
  } else if (event.type === 'todo.complete') {
    if (!state.todos.some(todo => todo.id === event.id)) throw new HouseholdError('NOT_FOUND');
    result.todos = state.todos.map(todo => todo.id === event.id ? { ...todo, ...audit(todo), completedAt: event.done ? now : null, completedBy: event.done ? actor : null } : todo);
  } else result.preferences = event.preferences;
  if (event.type === 'entry.add' || event.type === 'entry.correct') {
    let grossRecorded = 0;
    for (const entry of result.entries) {
      if (!entry.voidedAt) grossRecorded += entry.amount;
      if (!Number.isSafeInteger(grossRecorded)) fail('ledgerTotal');
    }
  }
  // Reject accidental aggregate overflow, but allow real overspending to be recorded and shown as a warning.
  for (const card of result.cards) { const summary = getCardSummary(result, card.id); if (!Number.isSafeInteger(summary.remaining) || Math.abs(summary.remaining) > MAX_WON) fail('cardBalance'); }
  return result;
}
export interface CardSummary {
  id: string; kind: CardKind; balanceMode: 'credit' | 'balance'; limit: number; remaining: number; available: number; used: number;
  openingUsed: number; spent: number; refunded: number; repaid: number; borrowed: number;
  overLimit: boolean; utilization: number;
}
export function getCardSummary(state: HouseholdState, cardId: string): CardSummary {
  const card = requireCard(state, cardId, true);
  const isCredit = cardUsesCredit(card);
  let remaining = card.openingRemaining + (isCredit ? card.limit - card.initialLimit : 0), spent = 0, refunded = 0, repaid = 0, borrowed = 0;
  for (const entry of state.entries) {
    if (entry.voidedAt) continue;
    if (entry.cardId === cardId) {
      if (entry.kind === 'expense') { remaining -= entry.amount; spent += entry.amount; }
      if (entry.kind === 'refund') { remaining += entry.amount; refunded += entry.amount; }
      if (entry.kind === 'repayment') { remaining += entry.amount; repaid += entry.amount; }
      if (entry.kind === 'borrowing') { remaining -= entry.amount; borrowed += entry.amount; }
      if (entry.kind === 'income') remaining += entry.amount;
      if (entry.kind === 'transfer') remaining -= entry.amount;
    }
    if (entry.toCardId === cardId && entry.kind === 'transfer') remaining += entry.amount;
    if (entry.repaymentSourceCardId === cardId && entry.kind === 'repayment') { remaining -= entry.amount; borrowed += entry.amount; }
  }
  const openingUsed = isCredit ? card.initialLimit - card.openingRemaining : 0;
  const used = isCredit ? card.limit - remaining : Math.max(0, spent - refunded);
  return { id: cardId, kind: card.kind, balanceMode: isCredit ? 'credit' : 'balance', limit: card.limit, remaining, available: Math.max(0, remaining), used, openingUsed, spent, refunded, repaid, borrowed, overLimit: remaining < 0,
    utilization: !isCredit ? 0 : card.limit === 0 ? used > 0 ? 1 : 0 : Math.max(0, used / card.limit) };
}
export function getCardsSummary(state: HouseholdState) {
  const cards = state.cards.filter(card => !card.archived).map(card => getCardSummary(state, card.id));
  const credit = cards.filter(card => card.balanceMode === 'credit'), debit = cards.filter(card => card.balanceMode === 'balance');
  return { cards, creditLimit: credit.reduce((n, c) => n + c.limit, 0), creditRemaining: credit.reduce((n, c) => n + c.remaining, 0), creditUsed: credit.reduce((n, c) => n + c.used, 0), debitBalance: debit.reduce((n, c) => n + c.remaining, 0), available: cards.reduce((n, c) => n + c.available, 0) };
}
export function seoulDate(instant: string | Date | number): string {
  const time = instant instanceof Date ? instant.getTime() : typeof instant === 'number' ? instant : Date.parse(parseHouseholdInstant(instant));
  if (!Number.isFinite(time)) return fail('instant');
  return new Date(time + 9 * 3_600_000).toISOString().slice(0, 10);
}
export type LedgerPeriod = 'day' | 'week' | 'month' | 'year';
export function householdPeriod(date: string, period: LedgerPeriod): { from: string; to: string } {
  if (!validHouseholdDate(date)) return fail('date');
  const current = new Date(date + 'T00:00:00Z');
  if (period === 'day') return { from: date, to: date };
  if (period === 'week') {
    const start = current.getTime() - ((current.getUTCDay() + 6) % 7) * 86_400_000;
    return { from: new Date(start).toISOString().slice(0, 10), to: new Date(start + 6 * 86_400_000).toISOString().slice(0, 10) };
  }
  if (period === 'month') return { from: date.slice(0, 7) + '-01', to: new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0)).toISOString().slice(0, 10) };
  if (period === 'year') return { from: date.slice(0, 4) + '-01-01', to: date.slice(0, 4) + '-12-31' };
  return fail('period');
}
export interface LedgerBucket { label: string; amount: number; count: number }
export function summarizeLedger(state: HouseholdState, from: string, to: string) {
  if (!validHouseholdDate(from) || !validHouseholdDate(to) || from > to) return fail('period');
  const entries = state.entries.filter(entry => !entry.voidedAt && seoulDate(entry.occurredAt) >= from && seoulDate(entry.occurredAt) <= to);
  const sum = (kind: EntryKind) => entries.filter(entry => entry.kind === kind).reduce((n, entry) => n + entry.amount, 0);
  const group = (key: (entry: HouseholdEntry) => string): LedgerBucket[] => {
    const groups = new Map<string, LedgerBucket>();
    for (const entry of entries) {
      if (entry.kind !== 'expense' && entry.kind !== 'refund') continue;
      const label = key(entry), previous = groups.get(label) ?? { label, amount: 0, count: 0 };
      groups.set(label, { label, amount: previous.amount + (entry.kind === 'refund' ? -entry.amount : entry.amount), count: previous.count + 1 });
    }
    return [...groups.values()].sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
  };
  const expense = sum('expense'), refunded = sum('refund'), income = sum('income');
  return { from, to, entries: [...entries].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), expense, refunded, netExpense: expense - refunded, income,
    salary: entries.filter(entry => entry.kind === 'income' && entry.incomeType === 'salary').reduce((n, entry) => n + entry.amount, 0),
    repayment: sum('repayment'), borrowing: sum('borrowing') + entries.filter(entry => entry.kind === 'repayment' && entry.repaymentSourceCardId).reduce((n, entry) => n + entry.amount, 0), transfer: sum('transfer'),
    netIncomeAfterExpense: income - expense + refunded, categories: group(entry => entry.category || '미분류'), subcategories: group(entry => [entry.category || '미분류', entry.subcategory || '세부 항목 없음'].join(' / ')), daily: group(entry => seoulDate(entry.occurredAt)) };
}
export function getSalaryPlan(state: HouseholdState, month: string) {
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month)) return fail('month');
  const period = householdPeriod(month + '-01', 'month'), report = summarizeLedger(state, period.from, period.to), plan = state.plans.find(item => item.month === month) ?? null;
  const allocated = plan?.allocations.reduce((n, item) => n + item.amount, 0) ?? 0;
  return { month, plan, plannedIncome: plan?.plannedIncome ?? 0, actualIncome: report.income, actualSalary: report.salary, allocated, unallocatedFromPlan: (plan?.plannedIncome ?? 0) - allocated, unallocatedFromActual: report.income - allocated, spent: report.netExpense, overAllocated: allocated > (plan?.plannedIncome ?? 0) };
}
export function dueHouseholdTodos(state: HouseholdState, nowIso: string, graceMinutes = 60): HouseholdTodo[] {
  const now = Date.parse(parseHouseholdInstant(nowIso));
  if (!Number.isInteger(graceMinutes) || graceMinutes < 0 || graceMinutes > 1440) return fail('graceMinutes');
  if (!state.preferences.todoReminders) return [];
  return state.todos.filter(todo => !todo.completedAt && todo.remind && todo.dueAt && Date.parse(todo.dueAt) <= now && (graceMinutes === 0 ? Date.parse(todo.dueAt) === now : Date.parse(todo.dueAt) > now - graceMinutes * 60_000));
}
