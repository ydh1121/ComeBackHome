import type { PresenceRepository, PresenceNotificationJobDraft } from '../../src/application/contracts/repositories';
import type { PresenceState } from '../../src/domain/models';
import type { D1DatabaseLike } from '../runtime-types';
import { batchOrThrow } from './d1-helpers';

interface PresenceStateRow {
  person_id: string;
  work_date: string;
  left_work_at: string | null;
  arrived_home_at: string | null;
  updated_at: string;
}

interface ReceiptRow {
  event_id: string;
  person_id: string;
  event_type: string;
  accepted_at: string;
}

function toState(row: PresenceStateRow): PresenceState {
  return {
    personId: row.person_id,
    workDate: row.work_date,
    ...(row.left_work_at ? { leftWorkAt: row.left_work_at } : {}),
    ...(row.arrived_home_at ? { arrivedHomeAt: row.arrived_home_at } : {}),
  };
}

export class D1PresenceRepository implements PresenceRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async get(personId: string): Promise<PresenceState | null> {
    const row = await this.db.prepare(
      `SELECT person_id, work_date, left_work_at, arrived_home_at, updated_at
       FROM presence_state WHERE person_id = ?1 LIMIT 1`,
    ).bind(personId).first<PresenceStateRow>();
    return row ? toState(row) : null;
  }

  private async findReceipt(eventId: string): Promise<ReceiptRow | null> {
    return this.db.prepare(
      'SELECT event_id, person_id, event_type, accepted_at FROM presence_events WHERE event_id = ?1 LIMIT 1',
    ).bind(eventId).first<ReceiptRow>();
  }

  private async confirmedDuplicate(
    receipt: ReceiptRow,
    input: { eventId: string; personId: string; type: 'LEFT_WORK' | 'ARRIVED_HOME'; notificationJob?: PresenceNotificationJobDraft },
  ): Promise<{ state: PresenceState; duplicate: boolean; queued: boolean; acceptedAt: string }> {
    if (receipt.person_id !== input.personId || receipt.event_type !== input.type) {
      throw new Error('PRESENCE_EVENT_ID_CONFLICT');
    }
    const state = await this.get(input.personId);
    if (!state) throw new Error('Presence event exists without current state.');
    const typeSlug = input.type === 'LEFT_WORK' ? 'left-work' : 'arrived-home';
    const originalDedupeKey = 'presence:' + typeSlug + ':' + input.personId + ':' + input.eventId;
    const job = await this.db.prepare(
      'SELECT id FROM notification_jobs WHERE dedupe_key = ?1 AND person_id = ?2 LIMIT 1',
    ).bind(originalDedupeKey, input.personId).first<{ id: string }>();
    return { state, duplicate: true, queued: Boolean(job), acceptedAt: receipt.accepted_at };
  }

  async record(input: {
    eventId: string;
    personId: string;
    type: 'LEFT_WORK' | 'ARRIVED_HOME';
    acceptedAt: string;
    workDate: string;
    notificationJob?: PresenceNotificationJobDraft;
  }): Promise<{ state: PresenceState; duplicate: boolean; queued: boolean; acceptedAt: string }> {
    const existing = await this.findReceipt(input.eventId);
    if (existing) return this.confirmedDuplicate(existing, input);
    if (input.notificationJob && input.notificationJob.personId !== input.personId) {
      throw new Error('PRESENCE_NOTIFICATION_PERSON_CONFLICT');
    }

    const current = await this.get(input.personId);
    const sameWorkDate = current?.workDate === input.workDate;
    const leftWorkAt = input.type === 'LEFT_WORK'
      ? input.acceptedAt
      : sameWorkDate ? current?.leftWorkAt ?? null : null;
    const arrivedHomeAt = input.type === 'ARRIVED_HOME'
      ? input.acceptedAt : null;

    // One D1 batch commits the event receipt, current presence, and its outbox
    // row together. No external Push call is inside the transaction.
    const statements = [
      this.db.prepare(
        `INSERT INTO presence_events (
          event_id, person_id, event_type, work_date, accepted_at, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
      ).bind(input.eventId, input.personId, input.type, input.workDate, input.acceptedAt),
      this.db.prepare(
        `INSERT INTO presence_state (
          person_id, work_date, left_work_at, arrived_home_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(person_id) DO UPDATE SET
          work_date = excluded.work_date,
          left_work_at = excluded.left_work_at,
          arrived_home_at = excluded.arrived_home_at,
          updated_at = excluded.updated_at`,
      ).bind(input.personId, input.workDate, leftWorkAt, arrivedHomeAt, input.acceptedAt),
    ];
    if (input.notificationJob) {
      const job = input.notificationJob;
      statements.push(this.db.prepare(
        `INSERT INTO notification_jobs (
          id, dedupe_key, person_id, job_type, scheduled_for, next_attempt_at,
          status, attempts, payload_json, sent_at, last_error, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', 0, ?7, NULL, NULL, ?8, ?8)`,
      ).bind(
        job.id, job.dedupeKey, job.personId, job.type, job.scheduledFor,
        job.nextAttemptAt, JSON.stringify(job.payload), input.acceptedAt,
      ));
    }

    try {
      await batchOrThrow(this.db, statements);
    } catch (error) {
      // A concurrent replay may lose the event_id UNIQUE race. Only an
      // already committed receipt for the SAME person/type is idempotent.
      const concurrent = await this.findReceipt(input.eventId);
      if (concurrent) return this.confirmedDuplicate(concurrent, input);
      throw error;
    }
    const state = await this.get(input.personId);
    if (!state) throw new Error('Presence state was not stored.');
    return {
      state, duplicate: false, queued: Boolean(input.notificationJob),
      acceptedAt: input.acceptedAt,
    };
  }
}
