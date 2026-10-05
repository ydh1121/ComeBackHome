import { createServer as createViteServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const workerEntry = await readFile(new URL('../worker/index.ts', import.meta.url), 'utf8');
const schedulerSource = await readFile(new URL('../worker/scheduler.ts', import.meta.url), 'utf8');

expect(
  workerEntry.includes('runScheduledNotificationCycle(env, controller.scheduledTime)'),
  'Worker scheduled entry must point at fail-closed composite cycle',
);
expect(
  !workerEntry.includes('runScheduledNotificationCycle(env, controller.scheduledTime,'),
  'Worker scheduled entry must not inject live notification dependencies yet',
);
for (const text of [
  'export async function runScheduledNotificationCycle',
  'planNotificationJobs(dependencies.planner, scheduledTime)',
  'processNotificationOutbox(',
  "status: 'not-configured'",
  'planningError',
]) {
  expect(schedulerSource.includes(text), 'scheduled composition missing ' + text);
}

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const scheduler = await vite.ssrLoadModule('/worker/scheduler.ts');

  class MemoryJobs {
    constructor(initial = []) {
      this.jobs = structuredClone(initial);
      this.keys = new Set(initial.map((job) => job.dedupeKey));
      this.claimCalls = 0;
    }

    async enqueueOnce(job) {
      if (this.keys.has(job.dedupeKey)) return;
      this.keys.add(job.dedupeKey);
      this.jobs.push({
        ...structuredClone(job),
        status: 'pending',
        attempts: 0,
        sentAt: null,
        lastError: null,
      });
    }

    async claimDue(nowIso, limit) {
      this.claimCalls += 1;
      const due = this.jobs
        .filter((job) =>
          ['pending', 'retry'].includes(job.status) &&
          job.nextAttemptAt <= nowIso &&
          job.scheduledFor <= nowIso
        )
        .sort((left, right) =>
          left.scheduledFor.localeCompare(right.scheduledFor) ||
          left.id.localeCompare(right.id)
        )
        .slice(0, limit);
      for (const job of due) {
        job.status = 'processing';
        job.attempts += 1;
      }
      return structuredClone(due);
    }

    async markSent(jobId, sentAt) {
      const job = this.jobs.find((candidate) => candidate.id === jobId);
      if (!job) throw new Error('missing memory job ' + jobId);
      job.status = 'sent';
      job.sentAt = sentAt;
      job.lastError = null;
    }

    async markRetry(jobId, nextAttemptAt, error) {
      const job = this.jobs.find((candidate) => candidate.id === jobId);
      if (!job) throw new Error('missing memory job ' + jobId);
      job.status = 'retry';
      job.nextAttemptAt = nextAttemptAt;
      job.lastError = error;
    }

    async markFailed(jobId, error) {
      const job = this.jobs.find((candidate) => candidate.id === jobId);
      if (!job) throw new Error('missing memory job ' + jobId);
      job.status = 'failed';
      job.lastError = error;
    }
  }

  class MemoryPlannerState {
    constructor() {
      this.states = new Map();
    }

    async get(personId) {
      return this.states.has(personId)
        ? structuredClone(this.states.get(personId))
        : null;
    }

    async upsert(state) {
      this.states.set(state.personId, structuredClone(state));
    }
  }

  class MemorySubscriptions {
    constructor() {
      this.listCalls = 0;
      this.records = [{
        id: 'sub-1',
        endpoint: 'https://push.invalid/device-1',
        expirationTime: null,
        keys: { p256dh: 'p1', auth: 'a1' },
        active: true,
        createdAt: '2026-10-05T00:00:00.000Z',
        updatedAt: '2026-10-05T00:00:00.000Z',
      }];
    }

    async upsert() { throw new Error('not used'); }
    async deactivateByEndpoint(endpoint) {
      const found = this.records.find((record) => record.endpoint === endpoint);
      if (found) found.active = false;
    }
    async listActive() {
      this.listCalls += 1;
      return structuredClone(this.records.filter((record) => record.active));
    }
  }

  const person = { id: 'person-1', name: '여자친구', relation: '연인' };
  const schedulesRows = [
    { id: 's1', personId: person.id, date: '2026-10-05', enabled: true, start: '09:00', end: '22:10' },
    { id: 's2', personId: person.id, date: '2026-10-07', enabled: true, start: '09:30', end: '18:30' },
  ];

  const jobs = new MemoryJobs();
  const plannerState = new MemoryPlannerState();
  const subscriptions = new MemorySubscriptions();
  const delivered = [];

  let eta = {
    personId: person.id,
    arrivalAt: '2026-10-05T13:48:00.000Z',
    confidence: 'FALLBACK',
  };

  const dependencies = {
    planner: {
      jobs,
      plannerState,
      people: {
        async list() { return [structuredClone(person)]; },
      },
      schedules: {
        async list(personId) {
          return structuredClone(schedulesRows.filter((row) => row.personId === personId));
        },
      },
      settings: {
        async get() {
          return {
            shiftEndEnabled: true,
            etaChangeEnabled: true,
            timezone: 'Asia/Seoul',
            updatedAt: '2026-10-05T00:00:00.000Z',
          };
        },
      },
      etaSource: {
        async get() { return structuredClone(eta); },
      },
    },
    outbox: {
      jobs,
      subscriptions,
      gateway: {
        async send(subscription, payload) {
          delivered.push({
            endpoint: subscription.endpoint,
            tag: payload.tag,
            body: payload.body,
          });
        },
      },
      retryPolicy: {
        nextAttempt() { return null; },
      },
      batchSize: 20,
    },
  };

  const firstTime = Date.parse('2026-10-05T13:10:00.000Z');
  const first = await scheduler.runScheduledNotificationCycle(
    { PUSH_DELIVERY_ENABLED: '1' },
    firstTime,
    dependencies,
  );

  expect(first.status === 'processed', 'first composite cycle status mismatch');
  expect(first.planningError === null, 'first composite cycle planning error');
  expect(first.planning?.shiftEndEnqueued === 1, 'first cycle did not plan shift-end');
  expect(first.planning?.etaBaselinesInitialized === 1, 'first cycle did not initialize ETA baseline');
  expect(first.planning?.etaChangeEnqueued === 0, 'first ETA observation must not generate change job');
  expect(first.delivery.claimed === 1 && first.delivery.sent === 1, 'first cycle must deliver due shift-end job');
  expect(delivered.length === 1, 'first cycle delivery count mismatch');
  expect(delivered[0]?.tag === 'cbh:shift-end:person-1:2026-10-05', 'first cycle delivered wrong job');
  expect(delivered[0]?.body.includes('다음 출근 10/7 09:30'), 'shift-end delivery missing next work');

  eta = {
    ...eta,
    arrivalAt: '2026-10-05T13:58:00.000Z',
  };

  const secondTime = Date.parse('2026-10-05T13:20:00.000Z');
  const second = await scheduler.runScheduledNotificationCycle(
    { PUSH_DELIVERY_ENABLED: '1' },
    secondTime,
    dependencies,
  );

  expect(second.planning?.etaChangeEnqueued === 1, 'second cycle must plan 10-minute ETA change');
  expect(second.delivery.claimed === 1 && second.delivery.sent === 1, 'second cycle must deliver due ETA change');
  expect(jobs.jobs.filter((job) => job.type === 'shift-end').length === 1, 'composite replanning duplicated shift-end job');
  expect(jobs.jobs.filter((job) => job.type === 'eta-change').length === 1, 'ETA change job count mismatch');
  expect(delivered.length === 2, 'second cycle total delivery count mismatch');
  expect(delivered[1]?.tag === 'cbh:eta-change:person-1', 'second cycle delivered wrong job');

  eta = {
    ...eta,
    arrivalAt: '2026-10-05T14:10:00.000Z',
    confidence: 'LIVE',
  };

  const cooldown = await scheduler.runScheduledNotificationCycle(
    { PUSH_DELIVERY_ENABLED: '1' },
    Date.parse('2026-10-05T13:25:00.000Z'),
    dependencies,
  );
  expect(cooldown.planning?.etaChangeEnqueued === 0, 'cooldown composite cycle must suppress ETA alert');
  expect(cooldown.delivery.claimed === 0, 'cooldown composite cycle must not deliver a new ETA alert');

  let disabledPlannerCalls = 0;
  const disabledDeps = {
    ...dependencies,
    planner: {
      ...dependencies.planner,
      people: {
        async list() {
          disabledPlannerCalls += 1;
          return [structuredClone(person)];
        },
      },
    },
  };

  const beforeDisabledClaims = jobs.claimCalls;
  const disabled = await scheduler.runScheduledNotificationCycle(
    { PUSH_DELIVERY_ENABLED: '0' },
    firstTime,
    disabledDeps,
  );
  expect(disabled.status === 'disabled', 'disabled composite cycle status mismatch');
  expect(disabled.planning === null, 'disabled composite cycle must not plan');
  expect(disabledPlannerCalls === 0, 'disabled composite cycle executed planner');
  expect(jobs.claimCalls === beforeDisabledClaims, 'disabled composite cycle claimed outbox jobs');

  const notConfigured = await scheduler.runScheduledNotificationCycle(
    { PUSH_DELIVERY_ENABLED: '1' },
    firstTime,
  );
  expect(notConfigured.status === 'not-configured', 'unconfigured composite cycle status mismatch');
  expect(notConfigured.planning === null, 'unconfigured composite cycle must not plan');
  expect(notConfigured.delivery.claimed === 0, 'unconfigured composite cycle must not claim jobs');

  const preloaded = new MemoryJobs([{
    id: 'pre-existing',
    dedupeKey: 'pre-existing',
    personId: person.id,
    type: 'fixture',
    scheduledFor: '2026-10-05T13:00:00.000Z',
    nextAttemptAt: '2026-10-05T13:00:00.000Z',
    status: 'pending',
    attempts: 0,
    payload: {
      title: 'ComeBackHome',
      body: 'pre-existing due job',
      tag: 'pre-existing',
      path: '/',
    },
    sentAt: null,
    lastError: null,
  }]);
  const isolationDelivered = [];
  const isolation = await scheduler.runScheduledNotificationCycle(
    { PUSH_DELIVERY_ENABLED: '1' },
    firstTime,
    {
      planner: {
        ...dependencies.planner,
        jobs: preloaded,
        people: {
          async list() {
            throw new Error('fixture planner failed');
          },
        },
      },
      outbox: {
        ...dependencies.outbox,
        jobs: preloaded,
        gateway: {
          async send(_subscription, payload) {
            isolationDelivered.push(payload.tag);
          },
        },
      },
    },
  );

  expect(isolation.status === 'processed', 'planning-error cycle must still process outbox');
  expect(isolation.planning === null, 'planning-error cycle must not return fake plan');
  expect(isolation.planningError === 'fixture planner failed', 'planning error was not surfaced safely');
  expect(isolation.delivery.claimed === 1 && isolation.delivery.sent === 1, 'planning error blocked existing due outbox');
  expect(isolationDelivered[0] === 'pre-existing', 'planning-error isolation delivered wrong job');
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5T scheduled notification composition verification passed');
