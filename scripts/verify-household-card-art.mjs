import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Synthetic bytes only. No live Drive, card image, or production API is used.
const vite = await createServer({ appType: 'custom', logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
let checks = 0;
const equal = (actual, expected, note) => { assert.deepEqual(actual, expected, note); checks++; };
const fakeStore = () => ({ rows: new Map(), async read(key) { return this.rows.get(key) ?? null; }, async write(row) { this.rows.set(row.key, row); }, async clear() { this.rows.clear(); } });
const noStore = { async read() { return null; }, async write() {}, async clear() {} };
const bytes = new Uint8Array([137, 80, 78, 71]);
const png = () => new Response(bytes, { headers: { 'Content-Type': 'image/png' } });
try {
  const { CardArtCache, IndexedCardArtStore } = await vite.ssrLoadModule('/src/modules/household/card-art-cache.ts');
  let calls = 0, now = Date.now();
  const store = fakeStore(), requests = [];
  const cache = new CardArtCache(store, async (url, init) => { requests.push({ url, init }); calls++; return png(); }, () => now);
  const first = await cache.load('synthetic-a', 'card-a', 'image-a', true);
  equal((await cache.load('synthetic-a', 'card-a', 'image-a', true)).size, first.size);
  equal(calls, 1, 'same image is served from memory');
  equal(requests[0].init.credentials, 'same-origin'); equal(requests[0].init.cache, 'no-store');
  equal(requests[0].url, '/api/private/household/cards/card-a/art?image=image-a');
  await cache.load('synthetic-b', 'card-a', 'image-a', true); equal(calls, 2, 'identity never shares a stored image');
  await cache.load('synthetic-a', 'card-a', 'image-b', true); equal(calls, 3, 'photo change uses a new key');
  const restarted = new CardArtCache(store, async () => { calls++; return png(); }, () => now);
  await restarted.load('synthetic-a', 'card-a', 'image-b', true); equal(calls, 3, 'persistent copy avoids reload after a new runtime');
  now += 24 * 60 * 60 * 1000;
  await restarted.load('synthetic-a', 'card-a', 'image-b', true); equal(calls, 4, '24h expiry requires a new authenticated response');
  now -= 48 * 60 * 60 * 1000;
  await restarted.load('synthetic-a', 'card-a', 'image-b', true); equal(calls, 5, 'future timestamps are not considered fresh');
  const disabled = new CardArtCache(store, async () => { calls++; return png(); });
  await disabled.load('synthetic-a', 'card-a', 'image-b', false);
  await disabled.load('synthetic-a', 'card-a', 'image-b', false); equal(calls, 7, 'OFF never reads or retains cached copies');
  await assert.rejects(() => disabled.load('../bad', 'card-a', 'image-a', true), /CARD_IMAGE_UNAVAILABLE/); checks++;
  let release;
  const joined = new CardArtCache(noStore, () => new Promise(resolve => { calls++; release = resolve; }));
  const before = calls;
  const a = joined.load('synthetic-a', 'card-a', 'same', true), b = joined.load('synthetic-a', 'card-a', 'same', true);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  release(png()); await Promise.all([a, b]); equal(calls, before + 1, 'simultaneous loads share one request');
  for (const response of [new Response('bad', { status: 403 }), new Response('bad', { headers: { 'Content-Type': 'text/html' } }), new Response('bad', { headers: { 'Content-Type': 'image/png', 'Content-Length': String(6 * 1024 * 1024) } })]) {
    const rejected = fakeStore(), subject = new CardArtCache(rejected, async () => response);
    await assert.rejects(() => subject.load('synthetic-a', 'card-a', 'bad', true)); checks++;
    equal(rejected.rows.size, 0, 'errors and invalid media are never cached');
  }
  const lateStore = fakeStore(); let releaseLate;
  const late = new CardArtCache(lateStore, () => new Promise(resolve => { releaseLate = resolve; }));
  const waiting = late.load('synthetic-a', 'card-a', 'late', true);
  while (!releaseLate) await new Promise(resolve => setImmediate(resolve));
  late.clear(); releaseLate(png());
  await assert.rejects(() => waiting, { name: 'AbortError' }); checks++;
  equal(lateStore.rows.size, 0, 'late network response after logout cannot re-populate storage');
  let releaseRead;
  const readStore = { ...fakeStore(), read: () => new Promise(resolve => { releaseRead = resolve; }) };
  const readLate = new CardArtCache(readStore, async () => { throw new Error('No fetch expected'); });
  const lateRead = readLate.load('synthetic-a', 'card-a', 'read', true);
  readLate.clear(); releaseRead(null);
  await assert.rejects(() => lateRead, { name: 'AbortError' }); checks++;
  let boundedCalls = 0;
  const bounded = new CardArtCache(noStore, async () => { boundedCalls++; return png(); });
  for (let i = 0; i < 21; i++) await bounded.load('synthetic-a', `card-${i}`, `image-${i}`, true);
  await bounded.load('synthetic-a', 'card-0', 'image-0', true);
  equal(boundedCalls, 22, 'memory has at most 20 distinct images');
  let byteCalls = 0;
  const byteBounded = new CardArtCache(noStore, async () => { byteCalls++; return new Response(new Uint8Array(4 * 1024 * 1024), { headers: { 'Content-Type': 'image/png' } }); });
  for (let i = 0; i < 6; i++) await byteBounded.load('synthetic-a', `card-${i}`, `image-${i}`, true);
  await byteBounded.load('synthetic-a', 'card-0', 'image-0', true);
  equal(byteCalls, 7, 'memory has at most 20MiB of image bytes');
  let blocked = true, diskReads = 0, diskWrites = 0;
  const blockedStore = { async clear() { if (blocked) throw Error('Blocked'); }, async read() { diskReads++; return null; }, async write() { diskWrites++; } };
  const retry = new CardArtCache(blockedStore, async () => png());
  retry.clear(); await retry.load('synthetic-a', 'card-a', 'blocked', true);
  equal([diskReads, diskWrites], [0, 0], 'failed purge forbids stale disk reads and refills');
  blocked = false; await retry.load('synthetic-a', 'card-b', 'unblocked', true);
  equal([diskReads, diskWrites], [1, 1], 'successful purge retry restores storage use');

  const originalIndexedDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  try {
    const opens = []; let closed = 0;
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open() { const request = {}; opens.push(request); return request; } } });
    const stalled = new IndexedCardArtStore(20);
    await assert.rejects(stalled.read('synthetic-key'), /CARD_IMAGE_STORE_TIMEOUT/); checks++;
    opens[0].result = { close() { closed++; } }; opens[0].onsuccess();
    equal(closed, 1, 'a database opening after deadline is immediately closed');
    await assert.rejects(stalled.clear(), /CARD_IMAGE_STORE_TIMEOUT/); checks++;
    equal(opens.length, 2, 'a timed-out operation does not block the serial queue');

    const operations = []; let releaseBytes;
    class DelayedBlob extends Blob { arrayBuffer() { return new Promise(resolve => { releaseBytes = resolve; }); } }
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open() {
      const request = {};
      request.result = { close() {}, transaction() {
        const transaction = { abort() {} };
        transaction.objectStore = () => ({
          getAll() { const read = { result: [] }; queueMicrotask(() => read.onsuccess()); return read; },
          clear() { operations.push('clear'); },
          put(row) { equal(row.bytes instanceof ArrayBuffer, true, 'only plain bytes enter IndexedDB'); equal(Object.hasOwn(row, 'blob'), false, 'Blob backing files are not persisted'); operations.push('put'); },
        });
        setTimeout(() => transaction.oncomplete(), 0);
        return transaction;
      } };
      queueMicrotask(() => request.onsuccess());
      return request;
    } } });
    const serial = new IndexedCardArtStore(1000);
    const writing = serial.write({ key: 'synthetic', userId: 'synthetic-a', cardId: 'card-a', imageFileId: 'image-a', savedAt: Date.now(), blob: new DelayedBlob([bytes], { type: 'image/png' }) });
    const clearing = serial.clear();
    while (!releaseBytes) await new Promise(resolve => setImmediate(resolve));
    equal(operations, [], 'conversion does not open an inactive transaction');
    releaseBytes(bytes.buffer.slice(0));
    await Promise.all([writing, clearing]);
    equal(operations, ['clear', 'put', 'clear'], 'logout purge remains after a slow image-byte conversion');
  } finally {
    if (originalIndexedDB) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDB); else delete globalThis.indexedDB;
  }
  console.log(`HOUSEHOLD_CARD_ART_PASS checks=${checks} identity_persistence_dedupe_version_expiry_limits_toggle_purge_late_response`);
} finally { await vite.close(); }
