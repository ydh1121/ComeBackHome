import type { NotificationJob, NotificationJobStore, NotificationPayload } from '../contracts';
import type { D1DatabaseLike } from '../runtime-types';
import { utcNow } from './d1-helpers';

interface NotificationJobRow {
  id: string;
  dedupe_key: string;
  person_id: string | null;
  job_type: string;
  scheduled_for: string;
  next_attempt_at: string;
  status: NotificationJob['status'];
  attempts: number;
  payload_json: string;
  sent_at: string | null;
  last_error: string | null;
}

function parsePayload(value: string): NotificationPayload {
  const parsed = JSON.parse(value) as Partial<NotificationPayload>;
  if (
    typeof parsed.title !== 'string'
    || typeof parsed.body !== 'string'
    || typeof parsed.tag !== 'string'
    || typeof parsed.path !== 'string'
  ) {
    throw new Error('Notification job payload is invalid.');
  }
  return {
    title: parsed.title,
    body: parsed.body,
    tag: parsed.tag,
    path: parsed.path,
  };
}

function toJob(row: NotificationJobRow): NotificationJob {
  return {
    id: row.id,
    dedupeKey: row.dedupe_key,
    personId: row.person_id,
    type: row.job_type,
    scheduledFor: row.scheduled_for,
    nextAttemptAt: row.next_attempt_at,
    status: row.status,
    attempts: row.attempts,
    payload: parsePayload(row.payload_json),
    sentAt: row.sent_at,
    lastError: row.last_error,
  };
}

// A Worker can be evicted after a due-job claim and before sending or
// updating its status. Reclaim an abandoned processing lease after a
// conservative timeout, without replaying a still-running delivery.
const PROCESSING_LEASE_MINUTES = 15;

export class D1NotificationJobStore implements NotificationJobStore {
  constructor(private readonly db: D1DatabaseLike) {}

  async setArrivalPlan(personId: string, workDate: string, arrivalAt: string | null, checkedAt: string, schedule?: { start: string; end: string }): Promise<void> {
    await this.db.prepare(`INSERT INTO notification_arrival_plan (person_id, work_date, arrival_at, checked_at, shift_start, shift_end)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(person_id) DO UPDATE SET
      work_date=excluded.work_date, arrival_at=excluded.arrival_at, checked_at=excluded.checked_at, shift_start=excluded.shift_start, shift_end=excluded.shift_end`)
      .bind(personId, workDate, arrivalAt, checkedAt, schedule?.start ?? null, schedule?.end ?? null).run();
  }

  async enqueueOnce(job: Omit<NotificationJob, 'status' | 'attempts' | 'sentAt' | 'lastError'>): Promise<void> {
    const now = utcNow();
    await this.db.prepare(
      `INSERT INTO notification_jobs (
        id, dedupe_key, person_id, job_type, scheduled_for, next_attempt_at,
        status, attempts, payload_json, sent_at, last_error, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', 0, ?7, NULL, NULL, ?8, ?8)
      ON CONFLICT(dedupe_key) DO UPDATE SET
        scheduled_for = excluded.scheduled_for,
        next_attempt_at = excluded.next_attempt_at,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
      WHERE notification_jobs.status = 'pending'
        AND (notification_jobs.scheduled_for <> excluded.scheduled_for
             OR notification_jobs.payload_json <> excluded.payload_json)`,
    ).bind(
      job.id,
      job.dedupeKey,
      job.personId,
      job.type,
      job.scheduledFor,
      job.nextAttemptAt,
      JSON.stringify(job.payload),
      now,
    ).run();
  }

  async claimDue(nowIso: string, limit: number): Promise<NotificationJob[]> {
    if (!Number.isFinite(Date.parse(nowIso))) throw new Error('INVALID_NOTIFICATION_CLAIM_TIME');
    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(Math.trunc(limit), 100)) : 20;
    const expiredBefore = new Date(
      Date.parse(nowIso) - PROCESSING_LEASE_MINUTES * 60_000,
    ).toISOString();
    // For canonical shift-end work, validate the *current* schedule inside the
    // same atomic UPDATE that claims the job. OFF/cancelled workdays and stale
    // end times may not produce a new Push, even before planner rescheduling.
    // Existing non-shift work and legacy isolated fixture jobs are unchanged.
    const currentShift = `(
      notification_jobs.job_type <> 'shift-end'
      OR notification_jobs.dedupe_key NOT LIKE 'shift-end:%'
      OR EXISTS (
        SELECT 1 FROM schedules AS s
        WHERE s.person_id = notification_jobs.person_id
          AND s.schedule_date = substr(notification_jobs.dedupe_key, -10)
          AND s.enabled = 1
          AND (strftime('%s', s.schedule_date || ' ' || s.end_time || ':00', '-9 hours') + CASE WHEN s.end_time < s.start_time THEN 86400 ELSE 0 END - 600)
              = CAST(strftime('%s', notification_jobs.scheduled_for) AS INTEGER)
          AND CAST(strftime('%s', ?1) AS INTEGER) <= CAST(strftime('%s', notification_jobs.scheduled_for) AS INTEGER) + 900
          AND NOT EXISTS (SELECT 1 FROM presence_state ps WHERE ps.person_id=s.person_id
            AND ps.work_date=s.schedule_date AND (ps.left_work_at IS NOT NULL OR ps.arrived_home_at IS NOT NULL))
      )
    )`;
    const arrivalValid = `(notification_jobs.job_type <> 'arrival-advance' OR EXISTS (
      SELECT 1 FROM notification_arrival_plan p JOIN schedules s
        ON s.person_id = p.person_id AND s.schedule_date = p.work_date
      JOIN notification_settings ns ON ns.id = 'default'
      WHERE p.person_id = notification_jobs.person_id AND s.enabled = 1
        AND ns.arrival_advance_enabled = 1
        AND s.start_time = p.shift_start AND s.end_time = p.shift_end
        AND NOT EXISTS (SELECT 1 FROM presence_state ps WHERE ps.person_id=s.person_id
          AND ps.work_date=s.schedule_date AND ps.arrived_home_at IS NOT NULL)
        AND p.work_date = substr(notification_jobs.dedupe_key, -10)
        AND strftime('%s', p.arrival_at) - 600 = CAST(strftime('%s', notification_jobs.scheduled_for) AS INTEGER)
        AND p.arrival_at > ?1 AND p.checked_at >= strftime('%Y-%m-%dT%H:%M:%fZ', ?1, '-2 minutes')
    ))`;
    const enabledRule = `(notification_jobs.job_type <> 'shift-end' OR EXISTS (
      SELECT 1 FROM notification_settings WHERE id='default' AND shift_end_enabled=1))`;
    const result = await this.db.prepare(
      `UPDATE notification_jobs
      SET status = 'processing',
          attempts = attempts + 1,
          updated_at = ?1
      WHERE id IN (
        SELECT id
        FROM notification_jobs
        WHERE (status IN ('pending', 'retry')
               OR (status = 'processing' AND updated_at <= ?3))
          AND next_attempt_at <= ?1
          AND scheduled_for <= ?1
          AND ${currentShift} AND ${arrivalValid} AND ${enabledRule}
        ORDER BY scheduled_for ASC, id ASC
        LIMIT ?2
      )
      AND (status IN ('pending', 'retry')
           OR (status = 'processing' AND updated_at <= ?3))
      AND ${currentShift} AND ${arrivalValid} AND ${enabledRule}
      RETURNING
        id, dedupe_key, person_id, job_type, scheduled_for, next_attempt_at,
        status, attempts, payload_json, sent_at, last_error`,
    ).bind(nowIso, safeLimit, expiredBefore).run<NotificationJobRow>();

    return (result.results ?? []).map(toJob);
  }

  // Fence delivery acknowledgements with the claim attempt (lease epoch).
  // A Worker whose 15-minute lease was reclaimed must not finalize another
  // Worker's processing attempt. The external Push side effect remains at-least-once.
  private requireClaim(claimAttempts: number | undefined): number {
    if (!Number.isInteger(claimAttempts) || (claimAttempts ?? 0) < 1) {
      throw new Error('NOTIFICATION_CLAIM_ATTEMPT_REQUIRED');
    }
    return claimAttempts as number;
  }

  async markSent(jobId: string, sentAt: string, claimAttempts?: number): Promise<boolean> {
    const result = await this.db.prepare(
      `UPDATE notification_jobs
      SET status = 'sent', sent_at = ?2, last_error = NULL, updated_at = ?2
      WHERE id = ?1 AND status = 'processing' AND attempts = ?3`,
    ).bind(jobId, sentAt, this.requireClaim(claimAttempts)).run();
    return result.meta?.changes === 1;
  }

  async markRetry(jobId: string, nextAttemptAt: string, error: string, claimAttempts?: number): Promise<boolean> {
    const result = await this.db.prepare(
      `UPDATE notification_jobs
      SET status = 'retry', next_attempt_at = ?2, last_error = ?3, updated_at = ?4
      WHERE id = ?1 AND status = 'processing' AND attempts = ?5`,
    ).bind(jobId, nextAttemptAt, error, utcNow(), this.requireClaim(claimAttempts)).run();
    return result.meta?.changes === 1;
  }

  async markFailed(jobId: string, error: string, claimAttempts?: number): Promise<boolean> {
    const result = await this.db.prepare(
      `UPDATE notification_jobs
      SET status = 'failed', last_error = ?2, updated_at = ?3
      WHERE id = ?1 AND status = 'processing' AND attempts = ?4`,
    ).bind(jobId, error, utcNow(), this.requireClaim(claimAttempts)).run();
    return result.meta?.changes === 1;
  }
}
