import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const apiSource = await readFile(new URL('../worker/api.ts', import.meta.url), 'utf8');
const ingestSource = await readFile(new URL('../worker/presence-event-ingest.ts', import.meta.url), 'utf8');

for (const text of [
  "segments[1] === 'presence-events'",
  'PRESENCE_EVENT_INGEST_TOKEN',
  "request.headers.get('Authorization')",
  "'LEFT_WORK'",
  "'ARRIVED_HOME'",
  'enqueuePresenceEvent(',
]) {
  expect(
    apiSource.includes(text) || ingestSource.includes(text),
    'presence-event contract missing ' + text,
  );
}
expect(
  !apiSource.includes("searchParams.get('token')"),
  'presence token must never be accepted from URL query parameters',
);
expect(
  ingestSource.includes("'presence:' + typeSlug + ':' + personId + ':' + eventId"),
  'presence event must have explicit idempotency key',
);

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const module = await vite.ssrLoadModule('/worker/presence-event-ingest.ts');

  const request = new Request('https://local.test/api/presence-events', {
    method: 'POST',
    headers: { Authorization: 'Bearer fixture-secret' },
  });
  expect(
    module.isPresenceEventAuthorized(request, 'fixture-secret') === true,
    'matching bearer token must authorize presence event',
  );
  expect(
    module.isPresenceEventAuthorized(request, 'wrong-secret') === false,
    'wrong bearer token must fail closed',
  );
  expect(
    module.isPresenceEventAuthorized(request, undefined) === false,
    'missing configured token must fail closed',
  );

  const person = { id: 'person-1', name: '여자친구', relation: '연인' };
  const rows = [
    {
      id: 'today',
      personId: person.id,
      date: '2026-10-06',
      enabled: true,
      start: '14:00',
      end: '22:00',
    },
    {
      id: 'next',
      personId: person.id,
      date: '2026-10-08',
      enabled: true,
      start: '09:30',
      end: '18:30',
    },
  ];
  const jobs = [];

  const dependencies = {
    jobs: {
      async enqueueOnce(job) { jobs.push(structuredClone(job)); },
      async claimDue() { return []; },
      async markSent() {},
      async markRetry() {},
      async markFailed() {},
    },
    people: {
      async list() { return [structuredClone(person)]; },
      async get(id) { return id === person.id ? structuredClone(person) : null; },
      async create() { throw new Error('not used'); },
      async update() { throw new Error('not used'); },
    },
    schedules: {
      async list(id) { return structuredClone(rows.filter((row) => row.personId === id)); },
      async getByDate() { return null; },
      async upsert() {},
      async upsertMany() {},
    },
  };

  const left = await module.enqueuePresenceEvent(
    dependencies,
    {
      eventId: 'shortcut-20261006T220100',
      personId: person.id,
      type: 'LEFT_WORK',
    },
    new Date('2026-10-06T13:01:00.000Z'),
  );
  expect(left.type === 'LEFT_WORK', 'LEFT_WORK result type mismatch');
  expect(jobs[0]?.type === 'presence-left-work', 'LEFT_WORK job type mismatch');
  expect(jobs[0]?.payload?.title === '여자친구 퇴근', 'LEFT_WORK title mismatch');
  expect(jobs[0]?.payload?.body?.includes('다음 출근 10/8 09:30'), 'LEFT_WORK payload lost next work');
  expect(
    jobs[0]?.dedupeKey === 'presence:left-work:person-1:shortcut-20261006T220100',
    'LEFT_WORK dedupe mismatch',
  );

  const arrived = await module.enqueuePresenceEvent(
    dependencies,
    {
      eventId: 'shortcut-20261006T230500',
      personId: person.id,
      type: 'ARRIVED_HOME',
    },
    new Date('2026-10-06T14:05:00.000Z'),
  );
  expect(arrived.type === 'ARRIVED_HOME', 'ARRIVED_HOME result type mismatch');
  expect(jobs[1]?.type === 'presence-arrived-home', 'ARRIVED_HOME job type mismatch');
  expect(jobs[1]?.payload?.title === '여자친구 집 도착', 'ARRIVED_HOME title mismatch');
  expect(jobs[1]?.payload?.body?.includes('다음 출근 10/8 09:30'), 'ARRIVED_HOME payload lost next work');

  let invalidIdBlocked = false;
  try {
    await module.enqueuePresenceEvent(
      dependencies,
      { eventId: 'bad', personId: person.id, type: 'LEFT_WORK' },
      new Date('2026-10-06T13:01:00.000Z'),
    );
  } catch {
    invalidIdBlocked = true;
  }
  expect(invalidIdBlocked, 'invalid eventId must fail closed');
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('trusted presence-event ingestion verification passed');
