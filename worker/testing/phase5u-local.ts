import type {
  NotificationEtaConfidence,
  NotificationPayload,
  StoredPushSubscription,
} from '../contracts';
import { createD1ScheduledNotificationDependencies } from '../notification-runtime';
import { D1NotificationSettingsStore } from '../repositories/D1NotificationSettingsStore';
import { D1NotificationJobStore } from '../repositories/D1NotificationJobStore';
import { D1PersonRepository } from '../repositories/D1PersonRepository';
import { D1ScheduleRepository } from '../repositories/D1ScheduleRepository';
import { D1PresenceRepository } from '../repositories/D1PresenceRepository';
import { D1SubscriptionStore } from '../repositories/D1SubscriptionStore';
import type { WorkerEnv } from '../runtime-types';
import { runScheduledNotificationCycle } from '../scheduler';

interface CycleRequest {
  scheduledTime: string;
  arrivalAt: string | null;
  confidence: NotificationEtaConfidence;
}

interface JobStateRow {
  id: string;
  dedupe_key: string;
  job_type: string;
  status: string;
  attempts: number;
  scheduled_for: string;
  next_attempt_at: string;
  sent_at: string | null;
  payload_json: string;
}

interface PlannerStateRow {
  person_id: string;
  eta_baseline_at: string | null;
  eta_baseline_work_date: string | null;
  last_eta_notification_at: string | null;
  updated_at: string;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

async function parseBody<T>(request: Request): Promise<T> {
  return request.json() as Promise<T>;
}

async function readState(env: WorkerEnv): Promise<{
  jobs: JobStateRow[];
  plannerState: PlannerStateRow[];
}> {
  const jobs = await env.DB.prepare(
    `SELECT id, dedupe_key, job_type, status, attempts, scheduled_for,
      next_attempt_at, sent_at, payload_json
    FROM notification_jobs
    ORDER BY scheduled_for ASC, id ASC`,
  ).all<JobStateRow>();

  const plannerState = await env.DB.prepare(
    `SELECT person_id, eta_baseline_at, eta_baseline_work_date,
      last_eta_notification_at, updated_at
    FROM notification_planner_state
    ORDER BY person_id ASC`,
  ).all<PlannerStateRow>();

  return {
    jobs: jobs.results,
    plannerState: plannerState.results,
  };
}

async function seed(env: WorkerEnv): Promise<Response> {
  const people = new D1PersonRepository(env.DB);
  const schedules = new D1ScheduleRepository(env.DB);
  const settings = new D1NotificationSettingsStore(env.DB);
  const subscriptions = new D1SubscriptionStore(env.DB);

  const person = await people.create({
    name: '여자친구',
    relation: '연인',
  });

  await schedules.upsertMany([
    {
      id: crypto.randomUUID(),
      personId: person.id,
      date: '2026-10-05',
      enabled: true,
      start: '09:00',
      end: '22:10',
    },
    {
      id: crypto.randomUUID(),
      personId: person.id,
      date: '2026-10-07',
      enabled: true,
      start: '09:30',
      end: '18:30',
    },
  ]);

  await settings.updateRules({
    shiftEndEnabled: true,
    etaChangeEnabled: true,
    leftWorkEnabled: true,
    homeArrivalEnabled: true,
  });

  const subscription = await subscriptions.upsert({
    endpoint: 'https://push.invalid/phase5u-device',
    expirationTime: null,
    keys: {
      p256dh: 'phase5u-p256dh',
      auth: 'phase5u-auth',
    },
  });

  return json({
    personId: person.id,
    subscriptionId: subscription.id,
  });
}

async function cycle(request: Request, env: WorkerEnv): Promise<Response> {
  const input = await parseBody<CycleRequest>(request);
  const scheduledTime = Date.parse(input.scheduledTime);

  if (!Number.isFinite(scheduledTime)) {
    return json({ error: 'scheduledTime must be a valid ISO timestamp.' }, 400);
  }

  const deliveries: Array<{
    endpoint: string;
    payload: NotificationPayload;
  }> = [];

  const dependencies = createD1ScheduledNotificationDependencies(env, {
    etaSource: {
      async get(personId) {
        return {
          personId,
          arrivalAt: input.arrivalAt,
          confidence: input.confidence,
        };
      },
    },
    gateway: {
      async send(
        subscription: StoredPushSubscription,
        payload: NotificationPayload,
      ): Promise<void> {
        deliveries.push({
          endpoint: subscription.endpoint,
          payload: structuredClone(payload),
        });
      },
    },
    retryPolicy: {
      nextAttempt() {
        return null;
      },
    },
    batchSize: 20,
  });

  const result = await runScheduledNotificationCycle(
    { ...env, PUSH_DELIVERY_ENABLED: '1' },
    scheduledTime,
    dependencies,
  );

  return json({
    result,
    deliveries,
    state: await readState(env),
  });
}


/** Test-only HTTP endpoint: verifies persisted D1 lease recovery using SQL. */
async function probeProcessingLease(env: WorkerEnv): Promise<Response> {
  const jobs = new D1NotificationJobStore(env.DB);
  const jobId = crypto.randomUUID();
  const initialTime = '2026-10-07T08:00:00.000Z';
  await jobs.enqueueOnce({
    id: jobId,
    dedupeKey: 'lease-probe:' + jobId,
    personId: null,
    type: 'fixture-probe',
    scheduledFor: '2026-10-07T07:59:00.000Z',
    nextAttemptAt: '2026-10-07T07:59:00.000Z',
    payload: { title: 'Synthetic lease', body: 'No remote send', tag: 'fixture-lease', path: '/' },
  });
  const initial = await jobs.claimDue(initialTime, 1);
  const oneSecondLater = '2026-10-07T08:00:01.000Z';
  const parallel = await Promise.all([
    jobs.claimDue(oneSecondLater, 1),
    jobs.claimDue(oneSecondLater, 1),
  ]);
  const withinLease = await jobs.claimDue('2026-10-07T08:14:59.000Z', 1);
  const expired = await jobs.claimDue('2026-10-07T08:15:00.000Z', 1);
  const duplicate = await jobs.claimDue('2026-10-07T08:15:01.000Z', 1);
  const staleCompletion = await jobs.markSent(jobId, '2026-10-07T08:15:01.000Z', initial[0]?.attempts);
  const currentCompletion = await jobs.markSent(jobId, '2026-10-07T08:15:01.000Z', expired[0]?.attempts);
  const afterSent = await jobs.claimDue('2026-10-07T09:00:00.000Z', 1);
  const persisted = await env.DB.prepare(
    'SELECT status, attempts, sent_at FROM notification_jobs WHERE id = ?1',
  ).bind(jobId).first<{status:string; attempts:number; sent_at:string | null}>();
  return json({
    initialClaims: initial.filter(j => j.id === jobId).length,
    immediateClaims: parallel.flat().filter(j => j.id === jobId).length,
    withinLeaseClaims: withinLease.filter(j => j.id === jobId).length,
    reclaimedClaims: expired.filter(j => j.id === jobId).length,
    duplicateClaims: duplicate.filter(j => j.id === jobId).length,
    afterSentClaims: afterSent.filter(j => j.id === jobId).length,
    staleCompletionIgnored: staleCompletion === false,
    currentCompletionAccepted: currentCompletion === true,
    status: persisted?.status,
    attempts: persisted?.attempts,
    sentAt: persisted?.sent_at,
    syntheticOnly: true,
  });
}


async function probeAtomicPresenceState(env: WorkerEnv): Promise<Response> {
  const person = await new D1PersonRepository(env.DB).create({
    name: 'Synthetic presence transaction',
    relation: 'test-only',
  });
  const presence = new D1PresenceRepository(env.DB);
  const input = {
    eventId: 'phasef-atomic-presence-' + person.id,
    personId: person.id,
    type: 'LEFT_WORK' as const,
    acceptedAt: '2026-10-07T13:00:00.000Z',
    workDate: '2026-10-07',
  };

  await env.DB.prepare(
    "CREATE TRIGGER cbh_phasef_abort_presence BEFORE INSERT ON presence_state BEGIN SELECT RAISE(ABORT, 'synthetic presence write failure'); END",
  ).run();
  let failed = false;
  try { await presence.record(input); }
  catch { failed = true; }
  finally { await env.DB.prepare('DROP TRIGGER IF EXISTS cbh_phasef_abort_presence').run(); }

  const eventAfterFailure = await env.DB.prepare(
    'SELECT event_id FROM presence_events WHERE event_id = ?1',
  ).bind(input.eventId).first();
  const stateAfterFailure = await presence.get(person.id);

  const success = await presence.record(input);
  const duplicate = await presence.record(input);
  let collisionBlocked = false;
  try {
    await presence.record({ ...input, personId: 'another-person-fixture' });
  } catch (error) {
    collisionBlocked = error instanceof Error && error.message === 'PRESENCE_EVENT_ID_CONFLICT';
  }
  const finalState = await presence.get(person.id);
  return json({
    failed,
    receiptRolledBack: eventAfterFailure === null,
    stateRolledBack: stateAfterFailure === null,
    firstAccepted: success.duplicate === false,
    replayIgnored: duplicate.duplicate === true,
    crossPersonIdCollisionBlocked: collisionBlocked,
    persistedLeftWorkAt: finalState?.leftWorkAt,
    syntheticOnly: true,
  });
}


async function probePendingReschedule(env: WorkerEnv): Promise<Response> {
  const jobs = new D1NotificationJobStore(env.DB);
  const id = crypto.randomUUID();
  const dedupeKey = 'phasef-shift-reschedule:' + id;
  const create = (scheduledFor: string, body: string) => ({
    id: crypto.randomUUID(),
    dedupeKey,
    personId: null,
    type: 'shift-end',
    scheduledFor,
    nextAttemptAt: scheduledFor,
    payload: { title: 'Synthetic shift', body, tag: 'phasef-shift', path: '/' },
  });
  await jobs.enqueueOnce(create('2026-10-07T08:00:00.000Z', 'before edit'));
  await jobs.enqueueOnce(create('2026-10-07T09:30:00.000Z', 'after edit'));
  const fetchRow = () => env.DB.prepare(
    'SELECT id, status, scheduled_for, next_attempt_at, payload_json FROM notification_jobs WHERE dedupe_key = ?1',
  ).bind(dedupeKey).first<{
    id:string;status:string;scheduled_for:string;next_attempt_at:string;payload_json:string;
  }>();
  const pending = await fetchRow();

  // Neither a queued retry nor an already delivered event may be replaced
  // by the planner's next scheduled poll.
  const firstClaim = (await jobs.claimDue('2026-10-07T09:31:00.000Z', 100))
    .find((job) => job.id === pending?.id);
  if (!firstClaim) throw new Error('Pending fixture job was not claimed');
  await jobs.markRetry(pending?.id ?? '', '2026-10-07T10:30:00.000Z', 'Synthetic transient failure', firstClaim.attempts);
  await jobs.enqueueOnce(create('2026-10-07T11:00:00.000Z', 'do not reset retry'));
  const retry = await fetchRow();
  const secondClaim = (await jobs.claimDue('2026-10-07T10:30:00.000Z', 100))
    .find((job) => job.id === pending?.id);
  if (!secondClaim) throw new Error('Retry fixture job was not claimed');
  await jobs.markSent(pending?.id ?? '', '2026-10-07T10:30:00.000Z', secondClaim.attempts);
  await jobs.enqueueOnce(create('2026-10-07T12:00:00.000Z', 'do not resend'));
  const sent = await fetchRow();
  return json({
    originalIdStable: pending?.id === sent?.id,
    pendingTimeUpdated: pending?.scheduled_for === '2026-10-07T09:30:00.000Z'
      && pending?.next_attempt_at === '2026-10-07T09:30:00.000Z',
    pendingPayloadUpdated: pending ? JSON.parse(pending.payload_json).body === 'after edit' : false,
    retryNotReset: retry?.status === 'retry'
      && retry.next_attempt_at === '2026-10-07T10:30:00.000Z',
    sentNotReset: sent?.status === 'sent'
      && sent.scheduled_for === '2026-10-07T09:30:00.000Z',
    syntheticOnly: true,
  });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      const row = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
      return json({ ok: row?.ok === 1 });
    }

    if (request.method === 'POST' && url.pathname === '/seed') {
      return seed(env);
    }

    if (request.method === 'POST' && url.pathname === '/cycle') {
      return cycle(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/pending-reschedule-probe') {
      return probePendingReschedule(env);
    }

    if (request.method === 'POST' && url.pathname === '/presence-atomic-probe') {
      return probeAtomicPresenceState(env);
    }

    if (request.method === 'POST' && url.pathname === '/lease-probe') {
      return probeProcessingLease(env);
    }

    if (request.method === 'GET' && url.pathname === '/state') {
      return json(await readState(env));
    }

    return json({ error: 'Not found.' }, 404);
  },
};
