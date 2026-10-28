import type { HouseholdState, ReminderRecipient } from '../../../src/modules/household/domain/model';
import type { D1DatabaseLike, WorkerEnv } from '../../runtime-types';
import type { NotificationPayload, NotificationRetryPolicy, PushDeliveryGateway, StoredPushSubscription } from '../../contracts';
import { PushDeliveryError } from '../../contracts';
import { createPushDeliveryRuntime } from '../../push-delivery-readiness';
import { FixedDelayNotificationRetryPolicy } from '../../notification-retry-policy';
import { pushSubscriptionKeyShapeValid } from '../../push/WebPushDeliveryGateway';
import { digest } from '../auth/crypto';
import { PrivateError, privateJson, readJson, type Principal } from '../auth/contracts';
import { seal, unseal } from '../documents/drive';

interface Reminder { id: string; dueAt: string; recipient?: ReminderRecipient }
interface Projection { revision: number; daily_enabled: number; todo_enabled: number; reminders_json: string }
interface Binding { role: 'admin' | 'member'; endpoint_hash: string; subscription_encrypted: string; user_id: string; session_hash: string; auth_epoch: number; created_at: string; updated_at: string }
interface Job { id: string; endpoint_hash: string; event_key: string; kind: 'ledger' | 'todo'; source_id: string | null; due_at: string; expires_at: string; attempts: number; claim_token: string }
export interface HouseholdReminderEvent { key: string; kind: 'ledger' | 'todo'; sourceId: string | null; dueAt: string; expiresAt: string; recipient: ReminderRecipient }
const HOUR = 3_600_000;
const memberSql = `u.disabled=0 AND u.must_change_password=0 AND u.login_id IN ('ydh1121','yvonne') AND u.auth_epoch=b.auth_epoch AND s.auth_epoch=b.auth_epoch AND s.user_id=b.user_id AND s.revoked_at IS NULL AND s.expires_at>?1 AND julianday(s.last_seen_at)>julianday(?1)-p.idle_hours/24.0`;

/** Tiny scheduler projection. Drive remains the only source of memo contents. */
export async function projectHouseholdReminders(db: D1DatabaseLike, state: HouseholdState): Promise<void> {
  const reminders = state.todos.filter(t => !t.archivedAt && !t.completedAt && t.remind && t.dueAt).map(t => ({ id: t.id, dueAt: t.dueAt!, recipient: t.reminderRecipient ?? 'both' }));
  await db.prepare(`INSERT INTO household_notification_projection(id,revision,daily_enabled,todo_enabled,reminders_json) VALUES(1,?1,?2,?3,?4)
    ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,daily_enabled=excluded.daily_enabled,todo_enabled=excluded.todo_enabled,reminders_json=excluded.reminders_json
    WHERE household_notification_projection.revision<=excluded.revision`)
    .bind(state.revision, Number(state.preferences.dailyLedgerReminder), Number(state.preferences.todoReminders), JSON.stringify(reminders)).run();
}

export function householdReminderEvents(projection: Projection, nowIso: string): HouseholdReminderEvent[] {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) return [];
  const result: HouseholdReminderEvent[] = [];
  // KST midnight, with a one-hour catch-up window when a scheduler tick is late.
  const date = new Date(now + 9 * HOUR).toISOString().slice(0, 10);
  const midnight = Date.parse(date + 'T00:00:00+09:00');
  if (projection.daily_enabled && now >= midnight && now < midnight + HOUR) result.push({ key: 'ledger:' + date, kind: 'ledger', sourceId: null, dueAt: new Date(midnight).toISOString(), expiresAt: new Date(midnight + HOUR).toISOString(), recipient: 'both' });
  if (projection.todo_enabled) {
    const reminders = JSON.parse(projection.reminders_json) as Reminder[];
    for (const reminder of reminders) {
      const due = Date.parse(reminder.dueAt), recipient = reminder.recipient ?? 'both';
      if (!['both', 'admin', 'member'].includes(recipient)) continue;
      if (due <= now && now < due + HOUR) result.push({ key: 'todo:' + reminder.id + ':' + reminder.dueAt, kind: 'todo', sourceId: reminder.id, dueAt: reminder.dueAt, expiresAt: new Date(due + HOUR).toISOString(), recipient });
    }
  }
  return result;
}

function allowedEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096) return false;
  try {
    const url = new URL(value), host = url.hostname;
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && (!url.port || url.port === '443') &&
      (host === 'web.push.apple.com' || host.endsWith('.push.apple.com') || host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' || host.endsWith('.notify.windows.com') || host.endsWith('.push.microsoft.com'));
  } catch { return false; }
}

/** Uses the browser's own subscription; never silently enables permission or changes schedule pushes. */
export async function handleHouseholdPushSubscription(request: Request, env: WorkerEnv, principal: Principal): Promise<Response> {
  if (!['ydh1121', 'yvonne'].includes(principal.loginId) || principal.mustChangePassword) throw new PrivateError(403, 'HOUSEHOLD_ACCESS_REQUIRED');
  if (!['PUT', 'POST', 'DELETE'].includes(request.method)) throw new PrivateError(405, 'METHOD_NOT_ALLOWED');
  const now = new Date().toISOString();
  const session = await env.DB.prepare(`SELECT u.id FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id CROSS JOIN auth_policy p
    WHERE p.id='default' AND s.token_hash=?1 AND s.user_id=?2 AND s.auth_epoch=?3 AND u.auth_epoch=s.auth_epoch AND u.login_id=?4 AND u.role=?5
    AND u.disabled=0 AND u.must_change_password=0 AND s.revoked_at IS NULL AND s.expires_at>?6 AND julianday(s.last_seen_at)>julianday(?6)-p.idle_hours/24.0`)
    .bind(principal.sessionHash, principal.id, principal.authEpoch, principal.loginId, principal.role, now).first();
  if (!session) throw new PrivateError(401, 'LOGIN_REQUIRED');
  const body = await readJson(request);
  if (!allowedEndpoint(body.endpoint)) throw new PrivateError(400, 'INVALID_PUSH_SUBSCRIPTION');
  const hash = await digest(body.endpoint);
  if (request.method === 'POST') {
    const registered = await env.DB.prepare(`SELECT endpoint_hash FROM household_push_bindings WHERE endpoint_hash=?1 AND user_id=?2 AND session_hash=?3 AND auth_epoch=?4 AND active=1`).bind(hash, principal.id, principal.sessionHash, principal.authEpoch).first();
    return privateJson({ registered: !!registered });
  }
  if (request.method === 'DELETE') {
    await env.DB.prepare(`UPDATE household_push_bindings SET active=0,updated_at=?3 WHERE endpoint_hash=?1 AND user_id=?2`).bind(hash, principal.id, now).run();
    return privateJson({ registered: false });
  }
  if (!body.keys || typeof body.keys !== 'object' || Array.isArray(body.keys)) throw new PrivateError(400, 'INVALID_PUSH_SUBSCRIPTION');
  const keys = body.keys as Record<string, unknown>;
  if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' || !pushSubscriptionKeyShapeValid({ p256dh: keys.p256dh, auth: keys.auth })) throw new PrivateError(400, 'INVALID_PUSH_SUBSCRIPTION');
  await env.DB.prepare(`UPDATE household_push_bindings SET active=0 WHERE user_id=?1 AND active=1 AND NOT EXISTS(SELECT 1 FROM auth_sessions s WHERE s.token_hash=household_push_bindings.session_hash AND s.user_id=?1 AND s.auth_epoch=?2 AND s.revoked_at IS NULL AND s.expires_at>?3)`).bind(principal.id,principal.authEpoch,now).run();
  const encrypted = await seal(JSON.stringify({ purpose: 'household-push/v1', endpointHash: hash, endpoint: body.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }), env);
  const stored = await env.DB.prepare(`INSERT INTO household_push_bindings(endpoint_hash,subscription_encrypted,user_id,session_hash,auth_epoch,active,created_at,updated_at)
    SELECT ?1,?2,?3,?4,?5,1,?6,?6 WHERE (SELECT COUNT(*) FROM household_push_bindings WHERE user_id=?3 AND active=1 AND endpoint_hash<>?1)<10
    ON CONFLICT(endpoint_hash) DO UPDATE SET subscription_encrypted=excluded.subscription_encrypted,user_id=excluded.user_id,session_hash=excluded.session_hash,auth_epoch=excluded.auth_epoch,active=1,updated_at=excluded.updated_at RETURNING endpoint_hash`)
    .bind(hash, encrypted, principal.id, principal.sessionHash, principal.authEpoch, now).first();
  if (!stored) throw new PrivateError(409, 'HOUSEHOLD_PUSH_DEVICE_LIMIT');
  return privateJson({ registered: true });
}

function payload(job: Job): NotificationPayload {
  return job.kind === 'ledger'
    ? { title: '생활비 기록', body: '어제 쓴 돈을 빠뜨리지 않았는지 확인해 보세요.', tag: job.event_key, path: '/household?section=ledger' }
    : { title: '할 일 알림', body: '알림을 설정한 할 일이 있어요.', tag: job.event_key, path: '/household?section=notes' };
}

async function activeBindings(db: D1DatabaseLike, now: string): Promise<Binding[]> {
  return (await db.prepare(`SELECT b.*,u.role FROM household_push_bindings b JOIN auth_users u ON u.id=b.user_id JOIN auth_sessions s ON s.token_hash=b.session_hash CROSS JOIN auth_policy p WHERE p.id='default' AND b.active=1 AND ${memberSql} ORDER BY b.endpoint_hash LIMIT 20`).bind(now).all<Binding>()).results;
}

async function eligible(db: D1DatabaseLike, job: Job, now: string, role: Binding['role']): Promise<boolean> {
  const projection = await db.prepare(`SELECT * FROM household_notification_projection WHERE id=1`).first<Projection>();
  return !!projection && householdReminderEvents(projection, now).some(e => e.key === job.event_key && (e.recipient === 'both' || e.recipient === role));
}

export interface HouseholdNotificationResult { status: 'disabled' | 'not-configured' | 'processed'; planned: number; sent: number; retry: number; cancelled: number; failed: number }

export async function runHouseholdNotificationCycle(env: WorkerEnv, scheduledTime: number, injected?: { gateway: PushDeliveryGateway; retryPolicy: NotificationRetryPolicy }): Promise<HouseholdNotificationResult> {
  const result: HouseholdNotificationResult = { status: 'disabled', planned: 0, sent: 0, retry: 0, cancelled: 0, failed: 0 };
  if (env.PRIVATE_WORK_ENABLED !== '1' || env.PUSH_DELIVERY_ENABLED !== '1' || env.MUTATIONS_ENABLED === '0') return result;
  const now = new Date(scheduledTime).toISOString();
  let runtime = injected;
  if (!runtime) {
    const push = createPushDeliveryRuntime(env);
    const delays = (env.NOTIFICATION_RETRY_DELAYS_SECONDS ?? '').split(',').map(Number);
    if (!push.ready || !push.gateway || !env.PRIVATE_DRIVE_TOKEN_KEY || !delays.length || delays.some(x => !Number.isFinite(x) || x < 0) || !env.NOTIFICATION_RETRY_DELAYS_SECONDS) return { ...result, status: 'not-configured' };
    runtime = { gateway: push.gateway, retryPolicy: new FixedDelayNotificationRetryPolicy(delays) };
  }
  result.status = 'processed';
  const writing = await env.DB.prepare(`SELECT id FROM household_workspace WHERE id='shared' AND (pending_id IS NOT NULL OR spreadsheet_id IS NULL)`).first();
  if (writing) return result;
  const projection = await env.DB.prepare('SELECT * FROM household_notification_projection WHERE id=1').first<Projection>();
  if (!projection) return result;
  const bindings = await activeBindings(env.DB, now), byHash = new Map(bindings.map(b => [b.endpoint_hash, b]));
  const events = householdReminderEvents(projection, now);
  // One deterministic row per event and device. Repeated ticks never resend an acknowledged device.
  // A recipient removed then re-added can resume an unsent, cancelled reminder in its original window.
  if (events.length && bindings.length) {
    const queued = await env.DB.prepare(`INSERT INTO household_notification_outbox(id,endpoint_hash,event_key,kind,source_id,due_at,expires_at,status,next_attempt_at)
      SELECT b.endpoint_hash||':'||json_extract(e.value,'$.key'), b.endpoint_hash, json_extract(e.value,'$.key'), json_extract(e.value,'$.kind'), json_extract(e.value,'$.sourceId'),json_extract(e.value,'$.dueAt'),json_extract(e.value,'$.expiresAt'),'pending',json_extract(e.value,'$.dueAt')
      FROM household_push_bindings b JOIN auth_users u ON u.id=b.user_id JOIN auth_sessions s ON s.token_hash=b.session_hash CROSS JOIN auth_policy p CROSS JOIN json_each(?2) e
      WHERE p.id='default' AND b.active=1 AND ${memberSql}
      AND (json_extract(e.value,'$.recipient')='both' OR json_extract(e.value,'$.recipient')=u.role)
      AND NOT EXISTS(SELECT 1 FROM household_notification_outbox o WHERE o.endpoint_hash=b.endpoint_hash AND o.event_key=json_extract(e.value,'$.key') AND o.status<>'cancelled') LIMIT 80
      ON CONFLICT(endpoint_hash,event_key) DO UPDATE SET status='pending',attempts=0,next_attempt_at=excluded.next_attempt_at,claim_token=NULL,lease_until=NULL,error_code=NULL
      WHERE household_notification_outbox.status='cancelled'`)
      .bind(now, JSON.stringify(events)).run();
    result.planned = Number(queued.meta?.changes ?? 0);
  }
  const claim = crypto.randomUUID();
  const jobs = (await env.DB.prepare(`UPDATE household_notification_outbox SET status='processing',attempts=attempts+1,claim_token=?2,lease_until=?3
    WHERE id IN (SELECT id FROM household_notification_outbox WHERE ((status IN ('pending','retry') AND next_attempt_at<=?1) OR (status='processing' AND lease_until<=?1)) ORDER BY next_attempt_at,id LIMIT 6)
    RETURNING *`).bind(now, claim, new Date(scheduledTime + 5 * 60_000).toISOString()).all<Job>()).results;
  for (const job of jobs) {
    const writingNow = await env.DB.prepare(`SELECT id FROM household_workspace WHERE id='shared' AND (pending_id IS NOT NULL OR spreadsheet_id IS NULL)`).first();
    if (writingNow) {
      await env.DB.prepare(`UPDATE household_notification_outbox SET status='retry',attempts=MAX(0,attempts-1),next_attempt_at=?3,claim_token=NULL,lease_until=NULL WHERE id=?1 AND claim_token=?2`).bind(job.id, claim, new Date(scheduledTime + 60_000).toISOString()).run(); result.retry++; continue;
    }
    let binding = byHash.get(job.endpoint_hash);
    // Recheck revocation immediately before delivery, including other-device logout.
    const valid = binding && await env.DB.prepare(`SELECT b.*,u.role FROM household_push_bindings b JOIN auth_users u ON u.id=b.user_id JOIN auth_sessions s ON s.token_hash=b.session_hash CROSS JOIN auth_policy p WHERE p.id='default' AND b.endpoint_hash=?2 AND b.active=1 AND ${memberSql}`).bind(now, job.endpoint_hash).first<Binding>();
    if (!valid || Date.parse(job.expires_at) <= scheduledTime || !(await eligible(env.DB, job, now, valid.role))) {
      await env.DB.prepare(`UPDATE household_notification_outbox SET status='cancelled',claim_token=NULL,lease_until=NULL WHERE id=?1 AND claim_token=?2`).bind(job.id, claim).run(); result.cancelled++; continue;
    }
    binding = valid;
    try {
      const raw = JSON.parse(await unseal(binding!.subscription_encrypted, env));
      if (raw.purpose !== 'household-push/v1' || raw.endpointHash !== binding!.endpoint_hash || !(allowedEndpoint(raw.endpoint))) throw new PrivateError(503, 'HOUSEHOLD_PUSH_KEY_INVALID');
      const subscription: StoredPushSubscription = { id: binding!.endpoint_hash, endpoint: raw.endpoint, keys: raw.keys, expirationTime: null, active: true, createdAt: binding!.created_at, updatedAt: binding!.updated_at };
      await runtime.gateway.send(subscription, payload(job));
      await env.DB.prepare(`UPDATE household_notification_outbox SET status='sent',sent_at=?3,claim_token=NULL,lease_until=NULL,error_code=NULL WHERE id=?1 AND claim_token=?2`).bind(job.id, claim, now).run(); result.sent++;
    } catch (error) {
      const terminal = error instanceof PushDeliveryError && error.kind === 'terminal-subscription';
      const permanent = terminal || error instanceof PrivateError || error instanceof PushDeliveryError && error.kind === 'permanent';
      const next = permanent ? null : runtime.retryPolicy.nextAttempt({ attempts: job.attempts } as never, new Error('HOUSEHOLD_PUSH_RETRY'), new Date(scheduledTime));
      if (terminal) await env.DB.prepare('UPDATE household_push_bindings SET active=0,updated_at=?2 WHERE endpoint_hash=?1').bind(job.endpoint_hash, now).run();
      const retry = next && Date.parse(next) < Date.parse(job.expires_at);
      await env.DB.prepare(`UPDATE household_notification_outbox SET status=?3,next_attempt_at=?4,error_code=?5,claim_token=NULL,lease_until=NULL WHERE id=?1 AND claim_token=?2`).bind(job.id, claim, retry ? 'retry' : 'failed', retry ? next : now, terminal ? 'SUBSCRIPTION_EXPIRED' : 'PUSH_DELIVERY_FAILED').run();
      if (retry) result.retry++; else result.failed++;
    }
  }
  // Delivery history is operational state, not a second permanent ledger.
  await env.DB.prepare(`DELETE FROM household_notification_outbox WHERE expires_at<?1 AND status IN ('sent','failed','cancelled')`).bind(new Date(scheduledTime - 32 * 24 * HOUR).toISOString()).run();
  return result;
}
