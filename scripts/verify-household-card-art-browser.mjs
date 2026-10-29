import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium, webkit } from 'playwright';
// Real browser storage, exclusively synthetic bytes. No provider calls.
const vite = await createServer({ appType: 'custom', logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
let checks = 0;
const equal = (actual, expected, note) => { assert.deepEqual(actual, expected, note); checks++; };
try {
  await vite.listen();
  const address = vite.httpServer.address(), base = `http://127.0.0.1:${address.port}`;
  vite.middlewares.use('/cache-test', (_, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Synthetic private cache test</title>'); });
  for (const [engine, name] of [[chromium, 'chromium'], [webkit, 'webkit']]) {
    const browser = await engine.launch({ headless: true, timeout: 30_000 });
    let deadline;
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(30_000); page.setDefaultNavigationTimeout(30_000);
      let stage = 'navigate', pageError = '';
      page.on('pageerror', error => { pageError = error.message; });
      await page.exposeFunction('reportCacheStage', value => { stage = value; console.log(`CARD_ART_BROWSER_STAGE ${name} ${value}`); });
      await page.goto(base + '/cache-test');
      const evaluated = page.evaluate(async () => {
        const report = value => window.reportCacheStage(value);
        const step = async (label, promise) => {
          await report(label);
          let timer;
          try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('CACHE_TEST_STEP_TIMEOUT ' + label)), 10_000); })]); }
          finally { clearTimeout(timer); }
        };
        const readAll = () => new Promise((resolve, reject) => {
          const request = indexedDB.open('cbh-household-card-art', 1);
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error('CACHE_TEST_READ_BLOCKED'));
          request.onsuccess = () => {
            const db = request.result, transaction = db.transaction('images'), read = transaction.objectStore('images').getAll();
            transaction.oncomplete = () => { db.close(); resolve(read.result); };
            transaction.onerror = transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('CACHE_TEST_READ_ABORTED')); };
          };
        });
        const { CardArtCache, IndexedCardArtStore } = await step('import', import('/src/modules/household/card-art-cache.ts'));
        const store = new IndexedCardArtStore(); await step('initial-clear', store.clear());
        let requests = 0;
        const fetcher = async () => { requests++; return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } }); };
        const first = new CardArtCache(store, fetcher);
        await step('first-load', first.load('synthetic-a', 'card-a', 'image-a', true));
        const second = new CardArtCache(new IndexedCardArtStore(), fetcher);
        await step('persisted-load', second.load('synthetic-a', 'card-a', 'image-a', true));
        await step('other-identity', second.load('synthetic-b', 'card-a', 'image-a', true));
        const beforeClear = requests;
        second.clear();
        await step('load-after-clear', new CardArtCache(new IndexedCardArtStore(), fetcher).load('synthetic-a', 'card-a', 'image-a', true));
        const afterClear = requests;
        const key = i => JSON.stringify(['synthetic-a', `card-${i}`, `image-${i}`]);
        await report('count-bound-write');
        for (let i = 0; i < 25; i++) await store.write({ key: key(i), userId: 'synthetic-a', cardId: `card-${i}`, imageFileId: `image-${i}`, savedAt: Date.now() - 1000 + i, blob: new Blob([new Uint8Array(1)], { type: 'image/png' }) });
        const rows = await step('count-bound-read', readAll());
        await step('clear-before-byte-bound', store.clear());
        await report('byte-bound-write');
        for (let i = 0; i < 6; i++) await store.write({ key: key(i), userId: 'synthetic-a', cardId: `card-${i}`, imageFileId: `image-${i}`, savedAt: Date.now(), blob: new Blob([new Uint8Array(4 * 1024 * 1024)], { type: 'image/png' }) });
        const byteRows = await step('byte-bound-read', readAll());
        await step('final-clear', store.clear());
        return { beforeClear, afterClear, count: rows.length, bytes: byteRows.reduce((total, row) => total + row.bytes.byteLength, 0) };
      });
      const result = await Promise.race([evaluated, new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`CARD_ART_BROWSER_TIMEOUT engine=${name} stage=${stage}${pageError ? ' pageError=' + pageError : ''}`)), 30_000);
      })]);
      clearTimeout(deadline);
      equal(result.beforeClear, 2, name + ': actual IndexedDB persists Blob and separates identities');
      equal(result.afterClear, 3, name + ': clear deletes persisted bytes before next load');
      equal(result.count, 20, name + ': persisted cache evicts entries beyond 20 images');
      equal(result.bytes, 20 * 1024 * 1024, name + ': persisted cache evicts bytes beyond 20MiB');
    } finally { clearTimeout(deadline); await browser.close(); }
  }
  console.log(`HOUSEHOLD_CARD_ART_BROWSER_PASS checks=${checks} chromium_webkit_indexeddb persistence_identity_limits_clear`);
} finally { await vite.close(); }
