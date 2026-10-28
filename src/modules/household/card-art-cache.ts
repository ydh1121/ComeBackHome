/** Private, opt-in device cache. Server authorization and response cache headers stay unchanged. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_IMAGES = 20;
const MAX_AGE = 24 * 60 * 60 * 1000;
const validId = (value: string) => /^[A-Za-z0-9_-]{1,200}$/.test(value);
const validBlob = (value: unknown): value is Blob => value instanceof Blob && value.size > 0 && value.size <= MAX_IMAGE_BYTES && ['image/png', 'image/jpeg', 'image/webp'].includes(value.type);
export interface CardArtRecord { key: string; userId: string; cardId: string; imageFileId: string; savedAt: number; blob: Blob }
export interface CardArtStore {
  read(key: string): Promise<CardArtRecord | null>;
  write(value: CardArtRecord): Promise<void>;
  clear(): Promise<void>;
}
export class CardArtError extends Error {
  constructor(public status: number) { super('CARD_IMAGE_UNAVAILABLE'); }
}
const fresh = (value: CardArtRecord, now: number) => Number.isSafeInteger(value.savedAt) && now >= value.savedAt && now - value.savedAt < MAX_AGE && validBlob(value.blob);
function bounded(values: CardArtRecord[], now: number): CardArtRecord[] {
  const result: CardArtRecord[] = [];
  let bytes = 0;
  for (const value of values.filter(value => fresh(value, now)).sort((a, b) => b.savedAt - a.savedAt)) {
    // Keep only the latest image per card and account, including replacements.
    if (result.some(row => row.userId === value.userId && row.cardId === value.cardId)) continue;
    if (result.length >= MAX_IMAGES || bytes + value.blob.size > MAX_TOTAL_BYTES) continue;
    result.push(value); bytes += value.blob.size;
  }
  return result;
}

/** Serialize storage changes so logout/clear cannot race an earlier write. */
export class IndexedCardArtStore implements CardArtStore {
  private queue: Promise<unknown> = Promise.resolve();
  private run<T>(action: (db: IDBDatabase) => Promise<T>): Promise<T> {
    const task = this.queue.catch(() => {}).then(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('cbh-household-card-art', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('images', { keyPath: 'key' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('CARD_IMAGE_STORE_BLOCKED'));
      });
      try { return await action(db); } finally { db.close(); }
    });
    this.queue = task;
    return task;
  }
  read(key: string) {
    return this.run(db => new Promise<CardArtRecord | null>((resolve, reject) => {
      const transaction = db.transaction('images', 'readonly');
      const request = transaction.objectStore('images').get(key);
      transaction.oncomplete = () => resolve(request.result ?? null);
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    }));
  }
  write(value: CardArtRecord) {
    return this.run(db => new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('images', 'readwrite');
      const store = transaction.objectStore('images');
      const request = store.getAll();
      request.onsuccess = () => {
        const retained = bounded([value, ...request.result.filter((row: CardArtRecord) => row.key !== value.key)], Date.now());
        store.clear();
        for (const row of retained) store.put(row);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    }));
  }
  clear() {
    return this.run(db => new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('images', 'readwrite');
      transaction.objectStore('images').clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    }));
  }
}

export class CardArtCache {
  private memory = new Map<string, CardArtRecord>();
  private requests = new Map<string, { promise: Promise<Blob>; abort: AbortController }>();
  private generation = 0;
  private purgePending = false;
  constructor(private store: CardArtStore, private fetcher: typeof fetch = (...args) => fetch(...args), private now = () => Date.now()) {}
  clear() {
    this.generation++;
    this.memory.clear();
    for (const request of this.requests.values()) request.abort.abort();
    this.requests.clear();
    this.purgePending = true;
    void this.purge();
  }
  private async purge() {
    const generation = this.generation;
    try { await this.store.clear(); if (generation === this.generation) this.purgePending = false; } catch { /* Retry before reading disk again. */ }
  }
  async load(userId: string, cardId: string, imageFileId: string, enabled: boolean): Promise<Blob> {
    if (![userId, cardId, imageFileId].every(validId)) throw new CardArtError(400);
    const key = JSON.stringify([userId, cardId, imageFileId]);
    const existing = this.requests.get(key);
    if (existing) return existing.promise;
    const generation = this.generation, abort = new AbortController();
    const current = () => { if (generation !== this.generation || abort.signal.aborted) throw new DOMException('Cleared', 'AbortError'); };
    const promise = (async () => {
      if (enabled) {
        const memory = this.memory.get(key);
        if (memory && fresh(memory, this.now())) return memory.blob;
        this.memory.delete(key);
        if (this.purgePending) await this.purge();
        current();
        if (!this.purgePending) {
          try {
            const stored = await this.store.read(key);
            current();
            if (stored?.key === key && stored.userId === userId && stored.cardId === cardId && stored.imageFileId === imageFileId && fresh(stored, this.now())) {
              this.retain(stored); return stored.blob;
            }
          } catch { current(); /* Unavailable device storage falls back to authenticated fetch. */ }
        }
      }
      const response = await this.fetcher('/api/private/household/cards/' + encodeURIComponent(cardId) + '/art?image=' + encodeURIComponent(imageFileId), { credentials: 'same-origin', cache: 'no-store', signal: abort.signal });
      current();
      if (!response.ok) throw new CardArtError(response.status);
      if (Number(response.headers.get('Content-Length')) > MAX_IMAGE_BYTES) throw new CardArtError(413);
      const blob = await response.blob();
      current();
      if (!validBlob(blob)) throw new CardArtError(415);
      if (enabled) {
        const value = { key, userId, cardId, imageFileId, savedAt: this.now(), blob };
        this.retain(value);
        // Do not keep new disk copies if a previous logout deletion is still blocked.
        if (!this.purgePending) await this.store.write(value).catch(() => {});
        current();
      }
      return blob;
    })();
    this.requests.set(key, { promise, abort });
    try { return await promise; } finally { if (this.requests.get(key)?.promise === promise) this.requests.delete(key); }
  }
  private retain(value: CardArtRecord) {
    this.memory = new Map(bounded([value, ...this.memory.values()].filter((row, index) => index === 0 || row.key !== value.key), this.now()).map(row => [row.key, row]));
  }
}
export const cardArtCache = new CardArtCache(new IndexedCardArtStore());
export function clearCardArtCache() { cardArtCache.clear(); }
