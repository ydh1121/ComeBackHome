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

export class D1NotificationJobStore implements NotificationJobStore {
  constructor(private readonly db: D1DatabaseLike) {}

  async enqueueOnce(job: Omit<NotificationJob, 'status' | 'attempts' | 'sentAt' | 'lastError'>): Promise<void> {
    const now = utcNow();
    await this.db.prepare(
      `INSERT INTO notification_jobs (
        id, dedupe_key, person_id, job_type, scheduled_for, next_attempt_at,
        status, attempts, payload_json, sent_at, last_error, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', 0, ?7, NULL, NULL, ?8, ?8)
      ON CONFLICT(dedupe_key) DO NOTHING`,
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
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
    const result = await this.db.prepare(
      `UPDATE notification_jobs
      SET status = 'processing',
          attempts = attempts + 1,
          updated_at = ?1
      WHERE id IN (
        SELECT id
        FROM notification_jobs
        WHERE status IN ('pending', 'retry')
          AND next_attempt_at <= ?1
          AND scheduled_for <= ?1
        ORDER BY scheduled_for ASC, id ASC
        LIMIT ?2
      )
      AND status IN ('pending', 'retry')
      RETURNING
        id, dedupe_key, person_id, job_type, scheduled_for, next_attempt_at,
        status, attempts, payload_json, sent_at, last_error`,
    ).bind(nowIso, safeLimit).run<NotificationJobRow>();

    return (result.results ?? []).map(toJob);
  }

  async markSent(jobId: string, sentAt: string): Promise<void> {
    await this.db.prepare(
      `UPDATE notification_jobs
      SET status = 'sent', sent_at = ?2, last_error = NULL, updated_at = ?2
      WHERE id = ?1`,
    ).bind(jobId, sentAt).run();
  }

  async markRetry(jobId: string, nextAttemptAt: string, error: string): Promise<void> {
    await this.db.prepare(
      `UPDATE notification_jobs
      SET status = 'retry', next_attempt_at = ?2, last_error = ?3, updated_at = ?4
      WHERE id = ?1`,
    ).bind(jobId, nextAttemptAt, error, utcNow()).run();
  }

  async markFailed(jobId: string, error: string): Promise<void> {
    await this.db.prepare(
      `UPDATE notification_jobs
      SET status = 'failed', last_error = ?2, updated_at = ?3
      WHERE id = ?1`,
    ).bind(jobId, error, utcNow()).run();
  }
}
