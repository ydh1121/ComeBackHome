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
        ORDER BY scheduled_for ASC, id ASC
        LIMIT ?2
      )
      AND (status IN ('pending', 'retry')
           OR (status = 'processing' AND updated_at <= ?3))
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
