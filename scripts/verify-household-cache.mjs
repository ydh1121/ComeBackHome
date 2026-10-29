import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'error', server: { middlewareMode: true } });
const store = Object.create(null);
Object.defineProperties(store, {
  getItem: { configurable: true, value(key) { return Object.hasOwn(this, key) ? this[key] : null; } },
  setItem: { configurable: true, value(key, value) { this[key] = String(value); } },
  removeItem: { configurable: true, value(key) { delete this[key]; } },
});
let blocked = false, events = 0;
const clearReasons = [];
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { if (blocked) throw new DOMException('Storage blocked', 'SecurityError'); return store; } });
Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent(event) { events++; clearReasons.push(event.detail?.reason); } } });
let checks = 0;
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
try {
  const domain = await vite.ssrLoadModule('/src/modules/household/domain/model.ts');
  const cache = await vite.ssrLoadModule('/src/modules/household/cache.ts');
  let state = domain.createHouseholdState(), commandId = 0;
  const now = '2028-01-01T00:00:00+09:00';
  const apply = event => { state = domain.applyHouseholdCommand(state, { id: `cache-command-${++commandId}`, expectedRevision: state.revision, event }, 'synthetic-a', now); };
  apply({ type: 'card.save', card: { id: 'card-a', name: 'Synthetic card', kind: 'credit', limit: 100_000, openingRemaining: 40_000, orientation: 'landscape' } });
  apply({ type: 'entry.add', entry: { id: 'entry-a', kind: 'expense', amount: 1_000, occurredAt: now, cardId: 'card-a' } });
  apply({ type: 'plan.save', plan: { id: 'plan-a', month: '2028-01', plannedIncome: 2_000, allocations: [{ id: 'allocation-a', label: 'Synthetic plan', amount: 1_000 }] } });
  apply({ type: 'todo.save', todo: { id: 'todo-a', text: 'Synthetic note', dueAt: now, remind: true } });
  const response = { ready: true, connected: true, snapshot: state, revision: state.revision, spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/synthetic-sheet/edit' };
  const key = 'cbh.household.cache.synthetic-a';
  const seed = (value, savedAt = Date.now()) => { cache.clearHouseholdCache(); store.setItem(key, JSON.stringify({ savedAt, value })); };
  equal(cache.householdCacheEnabled(), true);
  equal(cache.validHouseholdCacheResponse(response), true);
  const legacyNoteResponse=structuredClone(response); delete legacyNoteResponse.snapshot.todos[0].reminderRecipient;
  equal(cache.validHouseholdCacheResponse(legacyNoteResponse),true,'old snapshots without recipient remain usable');
  const archivedNoteResponse=structuredClone(response);
  Object.assign(archivedNoteResponse.snapshot.todos[0],{completedAt:'2028-01-01T00:00:00Z',completedBy:'synthetic-a',archivedAt:'2028-01-01T00:01:00Z',archivedBy:'synthetic-b',reminderRecipient:'member'});
  equal(cache.validHouseholdCacheResponse(archivedNoteResponse),true,'complete archive metadata and chosen recipient survive private caching');

  cache.writeCache('synthetic-a', response);
  equal(cache.readCache('synthetic-a').value, response);
  equal(cache.readCache('synthetic-b'), null, 'another identity never receives a cached snapshot');
  equal(cache.readCache('../synthetic-a'), null);
  equal(Object.keys(store).includes(key), true);
  seed(response);
  equal(cache.readCache('synthetic-a').value, response, 'a fresh serialized snapshot is accepted');
  seed(response, Date.now() - 24 * 60 * 60 * 1000 - 1);
  equal(cache.readCache('synthetic-a'), null);
  equal(store.getItem(key), null, 'expired copies are removed');
  seed(response, Date.now() + 60_000);
  equal(cache.readCache('synthetic-a'), null, 'clock-future timestamps cannot remain fresh indefinitely');
  for (const change of [
    copy => { copy.snapshot.entries = {}; },
    copy => { copy.snapshot.cards = null; },
    copy => { copy.snapshot.plans = 'bad'; },
    copy => { copy.snapshot.todos = false; },
    copy => { copy.snapshot.preferences = {}; },
    copy => { copy.snapshot.revision++; },
    copy => { copy.snapshot.schemaVersion = 2; },
    copy => { copy.snapshot.lastCommandPayload = 7; },
    copy => { copy.snapshot.entries[0].amount = -1; },
    copy => { copy.snapshot.entries[0].occurredAt = 'invalid'; },
    copy => { copy.snapshot.entries[0].cardId = 'absent'; },
    copy => { copy.snapshot.entries.push(copy.snapshot.entries[0]); },
    copy => { copy.snapshot.cards[0].initialLimit = null; },
    copy => { copy.snapshot.cards[0].name = null; },
    copy => { copy.snapshot.cards[0].updatedAt = 'invalid'; },
    copy => { copy.snapshot.entries[0].voidedAt = '2028-01-01T00:00:00Z'; },
    copy => { copy.snapshot.entries[0].voidedBy = 'synthetic-a'; },
    copy => { copy.snapshot.plans[0].month = '2028-13'; },
    copy => { copy.snapshot.plans.push({ ...copy.snapshot.plans[0], id: 'plan-b' }); },
    copy => { copy.snapshot.todos[0].completedAt = '2028-01-01T00:00:00Z'; },
    copy => { copy.snapshot.todos[0].dueAt = null; },
    copy => { copy.snapshot.todos[0].reminderRecipient = 'self'; },
    copy => { copy.snapshot.todos[0].reminderRecipient = ['both']; },
    copy => { copy.snapshot.todos[0].archivedAt = 'invalid'; },
    copy => { copy.snapshot.todos[0].archivedBy = 'synthetic-a'; },
    copy => { copy.snapshot.todos[0].archivedAt = '2028-01-01T00:00:00Z'; copy.snapshot.todos[0].archivedBy = 'synthetic-a'; },

    copy => { copy.spreadsheetUrl = 'javascript:alert(1)'; },
    copy => { copy.ready = 'true'; },
    copy => { copy.revision = -1; },
    copy => { copy.pending = 'yes'; },
  ]) {
    const changed = structuredClone(response); change(changed);
    equal(cache.validHouseholdCacheResponse(changed), false);
    seed(changed); equal(cache.readCache('synthetic-a'), null, 'bad structure never reaches view calculation');
  }
  cache.clearHouseholdCache();
  equal(clearReasons.at(-1),'security','unspecified purge cannot cause mounted private data to reload');
  cache.clearHouseholdCache('user');
  equal(clearReasons.at(-1),'user','explicit user clear permits a fresh authenticated image view');
  store.setItem(key, '{malformed');
  equal(cache.readCache('synthetic-a'), null, 'invalid JSON falls back to network');
  equal(store.getItem(key), null, 'bad JSON is removed instead of failing again on every visit');
  store.setItem(key, 'x'.repeat(2 * 1024 * 1024 + 1));
  equal(cache.readCache('synthetic-a'), null, 'oversized persisted input is discarded without parsing');
  store.setItem('unrelated-feature', 'keep');
  cache.writeCache('synthetic-a', response); cache.writeCache('synthetic-b', response);
  cache.setHouseholdCacheEnabled(false);
  equal(clearReasons.at(-1),'user','cache OFF purges bytes without disabling mounted image viewing');
  equal(cache.householdCacheEnabled(), false);
  equal(cache.readCache('synthetic-a'), null);
  equal(store.getItem(key), null);
  equal(store.getItem('cbh.household.cache.synthetic-b'), null);
  equal(store.getItem('unrelated-feature'), 'keep', 'private cache cleanup does not delete other product settings');
  cache.writeCache('synthetic-a', response);
  equal(store.getItem(key), null, 'disabled cache does not silently refill');
  cache.setHouseholdCacheEnabled(true);
  cache.writeCache('synthetic-a', response);
  equal(cache.readCache('synthetic-a').value, response);
  blocked = true;
  equal(cache.householdCacheEnabled(), true, 'blocked storage does not throw');
  cache.clearHouseholdCache();
  equal(cache.readCache('synthetic-a'), null, 'logout purge remains pending if the browser blocks disk access');
  cache.setHouseholdCacheEnabled(false);
  equal(cache.householdCacheEnabled(), false, 'disabled choice applies to this session even without writable storage');
  blocked = false;
  cache.setHouseholdCacheEnabled(true);
  equal(cache.readCache('synthetic-a'), null, 'a failed logout purge completes before old disk data can reappear');
  equal(store.getItem(key), null);
  blocked = true;
  cache.writeCache('synthetic-a', response);
  equal(cache.readCache('synthetic-a').value, response, 'memory cache still works after a completed purge when storage becomes unavailable');
  blocked = false;
  // A full storage device cannot turn a successful remote save into an app error.
  const quotaStore = new Proxy(store, { get(target, key) { if (key === 'setItem') return () => { throw new DOMException('Full', 'QuotaExceededError'); }; return Reflect.get(target, key); } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: quotaStore });
  cache.writeCache('synthetic-b', response);
  equal(cache.readCache('synthetic-b').value, response);
  cache.setHouseholdCacheEnabled(false);
  equal(cache.householdCacheEnabled(), false, 'a failed setting write does not undo the active session choice');
  equal(cache.readCache('synthetic-b'), null);
  assert.ok(events > 0); checks++;
  console.log(`HOUSEHOLD_CACHE_PASS checks=${checks} identities bounded_shape_validation timestamps corrupt_storage blocked_storage quota_failure purge_retry toggle_preserves_other_features`);
} finally {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage); else delete globalThis.localStorage;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else delete globalThis.window;
  await vite.close();
}

await import('./verify-household-card-art.mjs');
