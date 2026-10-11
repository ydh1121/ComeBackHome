import type { PresenceRepository } from '../../src/application/contracts/repositories';
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
       FROM presence_state
       WHERE person_id = ?1
       LIMIT 1`,
    ).bind(personId).first<PresenceStateRow>();
    return row ? toState(row) : null;
  }

  async record(input: {
    eventId: string;
    personId: string;
    type: 'LEFT_WORK' | 'ARRIVED_HOME';
    acceptedAt: string;
    workDate: string;
  }): Promise<{ state: PresenceState; duplicate: boolean }> {
    const existingEvent = await this.db.prepare(
      'SELECT event_id, person_id, event_type FROM presence_events WHERE event_id = ?1 LIMIT 1',
    ).bind(input.eventId).first<{ event_id: string; person_id: string; event_type: string }>();

    if (existingEvent) {
      if (existingEvent.person_id !== input.personId || existingEvent.event_type !== input.type) {
        throw new Error('PRESENCE_EVENT_ID_CONFLICT');
      }
      const state = await this.get(input.personId);
      if (!state) throw new Error('Presence event exists without current state.');
      return { state, duplicate: true };
    }

    const current = await this.get(input.personId);
    const sameWorkDate = current?.workDate === input.workDate;
    const leftWorkAt =
      input.type === 'LEFT_WORK'
        ? input.acceptedAt
        : sameWorkDate
          ? current?.leftWorkAt ?? null
          : null;
    const arrivedHomeAt =
      input.type === 'ARRIVED_HOME'
        ? input.acceptedAt
        : null;

    // Both the event receipt and the materialized current presence state
    // must commit together. Previously a failure between two .run() calls
    // left an event that forever suppressed a legitimate retry.
    try {
      await batchOrThrow(this.db, [
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
      ]);
    } catch (error) {
      // A concurrent replay can lose the unique-event race. Only return
      // duplicate when the durable receipt matches this person and type.
      const concurrent = await this.db.prepare(
        'SELECT person_id, event_type FROM presence_events WHERE event_id = ?1',
      ).bind(input.eventId).first<{person_id:string;event_type:string}>();
      if (concurrent?.person_id === input.personId && concurrent.event_type === input.type) {
        const state = await this.get(input.personId);
        if (state) return { state, duplicate: true };
      }
      throw error;
    }

    const state = await this.get(input.personId);
    if (!state) throw new Error('Presence state was not stored.');
    return { state, duplicate: false };
  }
}
