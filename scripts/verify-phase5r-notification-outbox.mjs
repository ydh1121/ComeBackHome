import { createServer as createViteServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const scheduler = await vite.ssrLoadModule('/worker/scheduler.ts');
  const contracts = await vite.ssrLoadModule('/worker/contracts.ts');

  class MemoryJobStore {
    constructor(jobs) {
      this.jobs = structuredClone(jobs);
      this.events = [];
    }

    async enqueueOnce() {}

    async claimDue(nowIso, limit) {
      const due = this.jobs
        .filter((job) =>
          ['pending', 'retry'].includes(job.status) &&
          job.nextAttemptAt <= nowIso &&
          job.scheduledFor <= nowIso
        )
        .slice(0, limit);
      for (const job of due) {
        job.status = 'processing';
        job.attempts += 1;
      }
      this.events.push(['claim', due.map((job) => job.id)]);
      return structuredClone(due);
    }

    async markSent(jobId, sentAt) {
      const job = this.jobs.find((candidate) => candidate.id === jobId);
      job.status = 'sent';
      job.sentAt = sentAt;
      job.lastError = null;
      this.events.push(['sent', jobId]);
    }

    async markRetry(jobId, nextAttemptAt, error) {
      const job = this.jobs.find((candidate) => candidate.id === jobId);
      job.status = 'retry';
      job.nextAttemptAt = nextAttemptAt;
      job.lastError = error;
      this.events.push(['retry', jobId]);
    }

    async markFailed(jobId, error) {
      const job = this.jobs.find((candidate) => candidate.id === jobId);
      job.status = 'failed';
      job.lastError = error;
      this.events.push(['failed', jobId]);
    }
  }

  class MemorySubscriptionStore {
    constructor(subscriptions) {
      this.subscriptions = structuredClone(subscriptions);
      this.deactivated = [];
    }

    async upsert() { throw new Error('not used'); }

    async deactivateByEndpoint(endpoint) {
      const subscription = this.subscriptions.find((candidate) => candidate.endpoint === endpoint);
      if (subscription) subscription.active = false;
      this.deactivated.push(endpoint);
    }

    async listActive() {
      return structuredClone(this.subscriptions.filter((subscription) => subscription.active));
    }
  }

  const now = Date.parse('2026-10-05T03:00:00.000Z');
  const payload = (tag) => ({
    title: 'ComeBackHome',
    body: tag,
    tag,
    path: '/',
  });
  const job = (id, tag, attempts = 0) => ({
    id,
    dedupeKey: 'dedupe:' + id,
    personId: 'person-1',
    type: 'fixture',
    scheduledFor: '2026-10-05T02:59:00.000Z',
    nextAttemptAt: '2026-10-05T02:59:00.000Z',
    status: 'pending',
    attempts,
    payload: payload(tag),
    sentAt: null,
    lastError: null,
  });

  const jobs = new MemoryJobStore([
    job('success', 'success'),
    job('retry', 'retry'),
    job('permanent', 'permanent'),
    job('terminal', 'terminal'),
    job('exhausted', 'exhausted', 2),
  ]);
  const subscriptions = new MemorySubscriptionStore([
    {
      id: 'invalid',
      endpoint: 'https://push.invalid/device-invalid',
      expirationTime: null,
      keys: { p256dh: 'p1', auth: 'a1' },
      active: true,
      createdAt: '2026-10-05T00:00:00.000Z',
      updatedAt: '2026-10-05T00:00:00.000Z',
    },
    {
      id: 'valid',
      endpoint: 'https://push.invalid/device-valid',
      expirationTime: null,
      keys: { p256dh: 'p2', auth: 'a2' },
      active: true,
      createdAt: '2026-10-05T00:00:00.000Z',
      updatedAt: '2026-10-05T00:00:00.000Z',
    },
  ]);

  const gateway = {
    async send(subscription, notification) {
      if (notification.tag === 'retry') {
        throw new contracts.PushDeliveryError('temporary push failure', 'transient');
      }
      if (notification.tag === 'exhausted') {
        throw new contracts.PushDeliveryError('temporary push failure', 'transient');
      }
      if (notification.tag === 'permanent') {
        throw new contracts.PushDeliveryError('payload rejected', 'permanent');
      }
      if (
        notification.tag === 'terminal' &&
        subscription.endpoint.endsWith('device-invalid')
      ) {
        throw new contracts.PushDeliveryError('subscription is gone', 'terminal-subscription');
      }
    },
  };

  const retryPolicy = {
    nextAttempt(currentJob, error, currentTime) {
      if (!(error instanceof Error)) return null;
      if (currentJob.attempts >= 3) return null;
      if (error.message === 'No active push subscription.') return null;
      return new Date(currentTime.getTime() + 60_000).toISOString();
    },
  };

  const result = await scheduler.processNotificationOutbox({
    jobs,
    subscriptions,
    gateway,
    retryPolicy,
    batchSize: 10,
  }, now);

  expect(result.status === 'processed', 'processor status mismatch');
  expect(result.claimed === 5, 'claimed count mismatch');
  expect(result.sent === 2, 'sent count mismatch');
  expect(result.retry === 1, 'retry count mismatch');
  expect(result.failed === 2, 'failed count mismatch');
  expect(result.deactivated === 1, 'deactivated count mismatch');

  expect(jobs.jobs.find((item) => item.id === 'success')?.status === 'sent', 'success job not sent');
  expect(jobs.jobs.find((item) => item.id === 'retry')?.status === 'retry', 'transient job not retried');
  expect(jobs.jobs.find((item) => item.id === 'permanent')?.status === 'failed', 'permanent job not failed');
  expect(jobs.jobs.find((item) => item.id === 'terminal')?.status === 'sent', 'terminal+valid fanout should still send');
  expect(jobs.jobs.find((item) => item.id === 'exhausted')?.status === 'failed', 'retry exhaustion not failed');
  expect(subscriptions.deactivated.includes('https://push.invalid/device-invalid'), 'terminal subscription not deactivated');

  const emptyJobs = new MemoryJobStore([job('no-subscription', 'success')]);
  const emptySubscriptions = new MemorySubscriptionStore([]);
  const emptyResult = await scheduler.processNotificationOutbox({
    jobs: emptyJobs,
    subscriptions: emptySubscriptions,
    gateway,
    retryPolicy,
  }, now);
  expect(emptyResult.failed === 1, 'no-subscription job must follow injected policy to failed');
  expect(emptyJobs.jobs[0]?.status === 'failed', 'no-subscription job state mismatch');

  const disabled = await scheduler.runScheduledTick(
    { PUSH_DELIVERY_ENABLED: '0' },
    now,
  );
  expect(disabled.status === 'disabled', 'disabled scheduler gate mismatch');
  expect(disabled.claimed === 0, 'disabled scheduler must not claim jobs');

  const unconfigured = await scheduler.runScheduledTick(
    { PUSH_DELIVERY_ENABLED: '1' },
    now,
  );
  expect(unconfigured.status === 'not-configured', 'enabled-without-gateway scheduler must fail closed');
  expect(unconfigured.claimed === 0, 'unconfigured scheduler must not claim jobs');
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5R notification outbox processor verification passed');
