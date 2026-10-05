import type {
  NotificationEtaConfidence,
  NotificationPayload,
  StoredPushSubscription,
} from '../contracts';
import { createD1ScheduledNotificationDependencies } from '../notification-runtime';
import { D1NotificationSettingsStore } from '../repositories/D1NotificationSettingsStore';
import { D1PersonRepository } from '../repositories/D1PersonRepository';
import { D1ScheduleRepository } from '../repositories/D1ScheduleRepository';
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

    if (request.method === 'GET' && url.pathname === '/state') {
      return json(await readState(env));
    }

    return json({ error: 'Not found.' }, 404);
  },
};
