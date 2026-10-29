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
import { D1NotificationRouteCache, NOTIFICATION_ROUTE_POLICY } from '../notification-route-cache';

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
    arrivalAdvanceEnabled: false,
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


/** Local D1 only: failure injection across receipt, state and outbox. */
async function probePresenceOutboxAtomic(env: WorkerEnv): Promise<Response> {
  const person = await new D1PersonRepository(env.DB).create({
    name: 'Atomic presence outbox fixture',
    relation: 'test-only',
  });
  const presence = new D1PresenceRepository(env.DB);
  const jobs = new D1NotificationJobStore(env.DB);
  const make = (suffix: string, type: 'LEFT_WORK' | 'ARRIVED_HOME' = 'LEFT_WORK', withJob = true) => {
    const eventId = 'presence-atomic-outbox-' + suffix + '-' + person.id;
    const acceptedAt = '2026-10-07T13:00:00.000Z';
    const slug = type === 'LEFT_WORK' ? 'left-work' : 'arrived-home';
    const job = {
      id: crypto.randomUUID(),
      dedupeKey: 'presence:' + slug + ':' + person.id + ':' + eventId,
      personId: person.id,
      type: 'presence-' + slug,
      scheduledFor: acceptedAt,
      nextAttemptAt: acceptedAt,
      payload: { title: 'Fixture', body: suffix, tag: 'fixture-' + suffix, path: '/' },
    };
    return {
      eventId, personId: person.id, type, acceptedAt, workDate: '2026-10-07',
      ...(withJob ? { notificationJob: job } : {}),
    };
  };
  const receipt = (eventId: string) => env.DB.prepare(
    'SELECT event_id FROM presence_events WHERE event_id = ?1',
  ).bind(eventId).first();
  const outbox = (key: string) => env.DB.prepare(
    'SELECT id FROM notification_jobs WHERE dedupe_key = ?1',
  ).bind(key).first();

  const failedInput = make('job-trigger');
  await env.DB.prepare(
    "CREATE TRIGGER cbh_phasef_abort_job BEFORE INSERT ON notification_jobs BEGIN SELECT RAISE(ABORT, 'synthetic notification job failure'); END",
  ).run();
  let jobInsertFailed = false;
  try { await presence.record(failedInput); } catch { jobInsertFailed = true; }
  finally { await env.DB.prepare('DROP TRIGGER IF EXISTS cbh_phasef_abort_job').run(); }
  const jobFailureRolledBack = (await receipt(failedInput.eventId)) === null
    && (await presence.get(person.id)) === null
    && (await outbox(failedInput.notificationJob!.dedupeKey)) === null;

  // UNIQUE violation on the outbox row must also roll back receipt and state.
  const constraintInput = make('unique-constraint');
  await jobs.enqueueOnce({ ...constraintInput.notificationJob!, id: crypto.randomUUID() });
  let constraintFailed = false;
  try { await presence.record(constraintInput); } catch { constraintFailed = true; }
  const constraintRolledBack = (await receipt(constraintInput.eventId)) === null
    && (await presence.get(person.id)) === null;

  const first = make('accepted');
  const accepted = await presence.record(first);
  const replay = await presence.record({ ...first, acceptedAt: '2026-10-07T13:05:00.000Z' });
  const activeCommitted = !accepted.duplicate && accepted.queued
    && Boolean(await receipt(first.eventId))
    && Boolean(await outbox(first.notificationJob!.dedupeKey));
  const stableReplay = replay.duplicate && replay.queued
    && replay.acceptedAt === first.acceptedAt;

  const stateBefore = await presence.get(person.id);
  const updateInput = make('state-update');
  await env.DB.prepare(
    "CREATE TRIGGER cbh_phasef_abort_state_update BEFORE UPDATE ON presence_state BEGIN SELECT RAISE(ABORT, 'synthetic state update failure'); END",
  ).run();
  let stateUpdateFailed = false;
  try { await presence.record(updateInput); } catch { stateUpdateFailed = true; }
  finally { await env.DB.prepare('DROP TRIGGER IF EXISTS cbh_phasef_abort_state_update').run(); }
  const stateUpdateRolledBack = (await receipt(updateInput.eventId)) === null
    && (await outbox(updateInput.notificationJob!.dedupeKey)) === null
    && (await presence.get(person.id))?.leftWorkAt === stateBefore?.leftWorkAt;

  const recovered = await presence.record(updateInput);
  const recoveryAccepted = !recovered.duplicate && recovered.queued;
  const racing = make('concurrent', 'ARRIVED_HOME');
  const concurrent = await Promise.allSettled([presence.record(racing), presence.record(racing)]);
  const raceEvents = await env.DB.prepare(
    'SELECT event_id FROM presence_events WHERE event_id = ?1',
  ).bind(racing.eventId).all();
  const raceJobs = await env.DB.prepare(
    'SELECT id FROM notification_jobs WHERE dedupe_key = ?1',
  ).bind(racing.notificationJob!.dedupeKey).all();
  const concurrentOnce = concurrent.some((entry) => entry.status === 'fulfilled')
    && raceEvents.results.length === 1 && raceJobs.results.length === 1
    && (await presence.record(racing)).duplicate;

  let crossPersonBlocked = false;
  let crossTypeBlocked = false;
  try { await presence.record({ ...first, personId: 'another-person-for-collision-check' }); }
  catch (error) { crossPersonBlocked = error instanceof Error && error.message === 'PRESENCE_EVENT_ID_CONFLICT'; }
  try { await presence.record({ ...first, type: 'ARRIVED_HOME' }); }
  catch (error) { crossTypeBlocked = error instanceof Error && error.message === 'PRESENCE_EVENT_ID_CONFLICT'; }

  const disabled = make('disabled', 'ARRIVED_HOME', false);
  const disabledResult = await presence.record(disabled);
  const disabledStateOnly = !disabledResult.queued && Boolean(await receipt(disabled.eventId))
    && (await presence.get(person.id))?.arrivedHomeAt === disabled.acceptedAt;
  // An old event without a job cannot be distinguished from one whose rule was
  // disabled at ingestion. Never fabricate a retroactive notification.
  const legacyReplay = await presence.record({
    ...disabled, notificationJob: make('disabled', 'ARRIVED_HOME').notificationJob,
  });
  const legacyGapFailClosed = legacyReplay.duplicate && !legacyReplay.queued;

  return json({
    syntheticOnly: true,
    jobInsertFailed,
    jobFailureRolledBack,
    constraintFailed,
    constraintRolledBack,
    activeCommitted,
    stableReplay,
    stateUpdateFailed,
    stateUpdateRolledBack,
    recoveryAccepted,
    concurrentOnce,
    crossPersonBlocked,
    crossTypeBlocked,
    disabledStateOnly,
    legacyGapFailClosed,
  });
}


/** Phase G preflight: verify that a stale shift-end job is never claimed after OFF or schedule change. */
async function probeShiftEndCurrentSchedule(env: WorkerEnv): Promise<Response> {
  const people = new D1PersonRepository(env.DB);
  const schedules = new D1ScheduleRepository(env.DB);
  const jobs = new D1NotificationJobStore(env.DB);
  const person = await people.create({ name: 'Shift validity synthetic employee', relation: 'test-only' });
  const makeSchedule = (date: string, end: string, enabled = true) => ({
    id: crypto.randomUUID(),
    personId: person.id,
    date, enabled,
    start: enabled ? '09:00' : '',
    end: enabled ? end : '',
  });
  const makeJob = (date: string, due: string) => ({
    id: crypto.randomUUID(),
    dedupeKey: 'shift-end:' + person.id + ':' + date,
    personId: person.id,
    type: 'shift-end',
    scheduledFor: due,
    nextAttemptAt: due,
    payload: { title: 'Synthetic shift', body: 'shift-' + date, tag: 'shift-' + date, path: '/' },
  });

  const offDate = '2026-10-07';
  const oldDate = '2026-10-08';
  const oldDue = '2026-10-08T07:50:00.000Z';
  const revisedDue = '2026-10-08T08:50:00.000Z';
  await schedules.upsert(makeSchedule(offDate, '17:00'));
  await jobs.enqueueOnce(makeJob(offDate, '2026-10-07T08:00:00.000Z'));
  await schedules.upsert(makeSchedule(offDate, '', false));
  const offClaims = await jobs.claimDue('2026-10-07T08:00:01.000Z', 100);
  const offBlocked = !offClaims.some(job =>
    job.dedupeKey === 'shift-end:' + person.id + ':' + offDate);

  await schedules.upsert(makeSchedule(oldDate, '17:00'));
  await jobs.enqueueOnce(makeJob(oldDate, oldDue));
  await schedules.upsert(makeSchedule(oldDate, '18:00'));
  const oldTimeClaims = await jobs.claimDue('2026-10-08T08:01:00.000Z', 100);
  const changedTimeBlocked = !oldTimeClaims.some(job =>
    job.dedupeKey === 'shift-end:' + person.id + ':' + oldDate);

  const oldRow = await env.DB.prepare(
    'SELECT id FROM notification_jobs WHERE dedupe_key = ?1',
  ).bind('shift-end:' + person.id + ':' + oldDate).first<{id:string}>();
  await jobs.enqueueOnce(makeJob(oldDate, revisedDue));
  const newRow = await env.DB.prepare(
    'SELECT id, scheduled_for FROM notification_jobs WHERE dedupe_key = ?1',
  ).bind('shift-end:' + person.id + ':' + oldDate).first<{id:string;scheduled_for:string}>();
  const newClaims = await jobs.claimDue('2026-10-08T09:00:01.000Z', 100);
  const correctedClaimed = newClaims.some(job =>
    job.dedupeKey === 'shift-end:' + person.id + ':' + oldDate && job.attempts === 1);
  const identityAndTimePreserved = oldRow?.id === newRow?.id
    && newRow?.scheduled_for === revisedDue;
  return json({
    syntheticOnly: true,
    offBlocked,
    changedTimeBlocked,
    correctedClaimed,
    identityAndTimePreserved,
  });
}

/** Exercise arrival policy in real local D1. Never uses a delivery gateway. */
async function probeArrivalPolicy(env: WorkerEnv): Promise<Response> {
  const people = new D1PersonRepository(env.DB);
  const schedules = new D1ScheduleRepository(env.DB);
  const settings = new D1NotificationSettingsStore(env.DB);
  const jobs = new D1NotificationJobStore(env.DB);
  const person = await people.create({ name: 'Arrival policy synthetic', relation: 'test-only' });
  const schedule = { id: crypto.randomUUID(), personId: person.id, date: '2026-10-09', enabled: true, start: '09:00', end: '17:00' };
  const now = '2026-10-09T08:30:00.000Z';
  const arrival = '2026-10-09T08:40:00.000Z';
  const job = { id: crypto.randomUUID(), personId: person.id, type: 'arrival-advance',
    dedupeKey: 'arrival-advance:' + person.id + ':' + schedule.date,
    scheduledFor: now, nextAttemptAt: now,
    payload: { title: 'Synthetic arrival', body: 'test only', tag: 'arrival-probe', path: '/' } };
  const claimed = async () => (await jobs.claimDue(now, 100)).filter(row => row.personId === person.id);
  const rules = { shiftEndEnabled: true, etaChangeEnabled: false, leftWorkEnabled: false, homeArrivalEnabled: false };
  await settings.updateRules({ ...rules, arrivalAdvanceEnabled: true });
  await schedules.upsert(schedule);
  await jobs.enqueueOnce(job);
  await jobs.setArrivalPlan(person.id, schedule.date, arrival, now, schedule);
  await schedules.upsert({ ...schedule, end: '18:00' });
  const changedBlocked = (await claimed()).length === 0;
  await schedules.upsert({ ...schedule, enabled: false });
  const offBlocked = (await claimed()).length === 0;
  await schedules.upsert(schedule);
  await settings.updateRules({ ...rules, arrivalAdvanceEnabled: false });
  const ruleOffBlocked = (await claimed()).length === 0;
  await settings.updateRules({ ...rules, arrivalAdvanceEnabled: true });
  await jobs.setArrivalPlan(person.id, schedule.date, arrival, '2026-10-09T08:27:00.000Z', schedule);
  const staleBlocked = (await claimed()).length === 0;
  await jobs.setArrivalPlan(person.id, schedule.date, null, now, schedule);
  const noEtaBlocked = (await claimed()).length === 0;
  await jobs.setArrivalPlan(person.id, schedule.date, arrival, now, schedule);
  const first = await claimed();
  const claimedOnce = first.length === 1 && (await claimed()).length === 0;
  if (first[0]) await jobs.markSent(first[0].id, now, first[0].attempts);
  await jobs.enqueueOnce({ ...job, id: crypto.randomUUID() });
  const sentNotReplayed = (await claimed()).length === 0;
  // Turn the new rule off again so legacy planner fixtures remain isolated.
  await settings.updateRules({ ...rules, arrivalAdvanceEnabled: false });
  return json({ syntheticOnly: true, changedBlocked, offBlocked, ruleOffBlocked, staleBlocked, noEtaBlocked, claimedOnce, sentNotReplayed });
}


/** Exact cache reservation SQL on real local D1; no provider or delivery. */
async function probeRouteCache(env: WorkerEnv): Promise<Response> {
  const person = await new D1PersonRepository(env.DB).create({ name: 'Route cache synthetic', relation: 'test-only' });
  const cache = new D1NotificationRouteCache(env.DB);
  const now = new Date('2026-10-09T08:45:00.000Z');
  const [first, parallel] = await Promise.all([
    cache.acquire(person.id, 'fixture-context', now), cache.acquire(person.id, 'fixture-context', now),
  ]);
  const token = first ?? parallel;
  if (!token) throw new Error('LOCAL_CACHE_LEASE_MISSING');
  const exclusive = Number(!!first) + Number(!!parallel) === 1;
  let reserved = 0;
  for (let i = 0; i < 30; i++) if (await cache.reserveRequest(person.id, token, now)) reserved++;
  const recovered = await cache.acquire(person.id, 'fixture-context', new Date(now.getTime() + 120_000));
  if (!recovered) throw new Error('LOCAL_CACHE_LEASE_RECOVERY_MISSING');
  await cache.complete(person.id, token, { id: 'stale-owner', totalMinutes: 999 }, now, now);
  const fenced = (await cache.get(person.id))?.route === null;
  await cache.complete(person.id, recovered, { id: 'fixture-route', totalMinutes: 40 }, new Date(now.getTime() + 120_000), now);
  const reloaded = await new D1NotificationRouteCache(env.DB).get(person.id);
  const hit = await cache.acquire(person.id, 'fixture-context', new Date(now.getTime() + 180_000));
  const changed = await cache.acquire(person.id, 'changed-context', new Date(now.getTime() + 180_000));
  const budgetSurvivesChange = !!changed && !await cache.reserveRequest(person.id, changed, new Date(now.getTime() + 180_000));
  const nextDay = new Date(now.getTime() + 86_400_000);
  const rolloverToken = await cache.acquire(person.id, 'changed-context', nextDay);
  const rollover = !!rolloverToken && await cache.reserveRequest(person.id, rolloverToken, nextDay);
  return json({ syntheticOnly: true, exclusive, dailyBudget: reserved === NOTIFICATION_ROUTE_POLICY.maxRequestsPerPersonDay,
    recovered: !!recovered, fenced, persisted: reloaded?.route?.totalMinutes === 40, validHitNoLease: hit === null,
    budgetSurvivesChange, rollover });
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

    if (request.method === 'POST' && url.pathname === '/route-cache-probe') return probeRouteCache(env);

    if (request.method === 'POST' && url.pathname === '/arrival-policy-probe') return probeArrivalPolicy(env);

    if (request.method === 'POST' && url.pathname === '/shift-current-validity-probe') {
      return probeShiftEndCurrentSchedule(env);
    }

    if (request.method === 'POST' && url.pathname === '/pending-reschedule-probe') {
      return probePendingReschedule(env);
    }

    if (request.method === 'POST' && url.pathname === '/presence-outbox-atomic-probe') {
      return probePresenceOutboxAtomic(env);
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
