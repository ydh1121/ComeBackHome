import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

let prepareCalls = 0;
const DB = {
  prepare(query) {
    prepareCalls += 1;
    return {
      bind() { return this; },
      async first() {
        if (query === 'SELECT 1 AS ok') return { ok: 1 };
        throw new Error('unexpected D1 first query: ' + query);
      },
      async all() { throw new Error('unexpected D1 all query'); },
      async run() { throw new Error('unexpected D1 run query'); },
    };
  },
  async batch() { throw new Error('unexpected D1 batch'); },
};

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const api = await vite.ssrLoadModule('/worker/api.ts');

  const post = await api.handleApiRequest(
    new Request('https://worker.invalid/api/people', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'blocked', relation: 'blocked' }),
    }),
    { DB, MUTATIONS_ENABLED: '0' },
  );
  const postBody = await post.json();
  expect(post.status === 503, 'staging POST must be blocked with 503');
  expect(
    postBody?.error === 'API mutations are temporarily disabled.',
    'staging mutation error contract mismatch',
  );
  expect(prepareCalls === 0, 'blocked mutation touched D1');

  const presence = await api.handleApiRequest(
    new Request('https://worker.invalid/api/presence-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: 'blocked',
        personId: 'blocked',
        type: 'ARRIVED_HOME',
      }),
    }),
    { DB, MUTATIONS_ENABLED: '0', PRESENCE_EVENT_INGEST_TOKEN: 'fixture' },
  );
  expect(presence.status === 503, 'presence mutation must respect staging gate');
  expect(prepareCalls === 0, 'blocked presence event touched D1');

  const health = await api.handleApiRequest(
    new Request('https://worker.invalid/api/health'),
    { DB, MUTATIONS_ENABLED: '0' },
  );
  const healthBody = await health.json();
  expect(health.status === 200 && healthBody?.ok === true, 'health GET must remain readable');
  expect(prepareCalls === 1, 'health GET did not reach D1 exactly once');

  const provider = await api.handleApiRequest(
    new Request('https://worker.invalid/api/providers/status'),
    { DB, MUTATIONS_ENABLED: '0', PROVIDER_RUNTIME_ENABLED: '0' },
  );
  const providerBody = await provider.json();
  expect(provider.status === 200, 'provider status GET must remain readable');
  expect(providerBody?.enabled === false, 'provider status changed under mutation gate');
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('parallel Worker mutation gate verification passed');
