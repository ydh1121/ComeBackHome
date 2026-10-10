import type { ScheduleRepository } from '../../src/application/contracts/repositories';
import type { EntityId, ISODate } from '../../src/domain/common';
import type { ScheduleEntry } from '../../src/domain/models';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../runtime-types';
import { asBoolean, asInteger, batchOrThrow, utcNow } from './d1-helpers';

interface ScheduleRow {
  id: string;
  person_id: string;
  schedule_date: string;
  enabled: number;
  start_time: string;
  end_time: string;
  break_minutes: number | null;
}

function toSchedule(row: ScheduleRow): ScheduleEntry {
  return {
    id: row.id,
    personId: row.person_id,
    date: row.schedule_date,
    enabled: asBoolean(row.enabled),
    start: row.start_time,
    end: row.end_time,
    breakMinutes: row.break_minutes,
  };
}

export class D1ScheduleRepository implements ScheduleRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async list(personId: EntityId): Promise<ScheduleEntry[]> {
    const result = await this.db.prepare(
      'SELECT id, person_id, schedule_date, enabled, start_time, end_time, break_minutes FROM schedules WHERE person_id = ?1 ORDER BY schedule_date ASC',
    ).bind(personId).all<ScheduleRow>();
    return result.results.map(toSchedule);
  }

  async getByDate(personId: EntityId, date: ISODate): Promise<ScheduleEntry | null> {
    const row = await this.db.prepare(
      'SELECT id, person_id, schedule_date, enabled, start_time, end_time, break_minutes FROM schedules WHERE person_id = ?1 AND schedule_date = ?2 LIMIT 1',
    ).bind(personId, date).first<ScheduleRow>();
    return row ? toSchedule(row) : null;
  }

  async upsert(entry: ScheduleEntry): Promise<void> {
    await this.upsertMany([entry]);
  }

  async upsertMany(entries: ScheduleEntry[]): Promise<void> {
    await batchOrThrow(this.db, this.scheduleStatements(entries));
  }

  /** D1.batch is one transaction: new people and every shift are all-or-none. */
  async upsertApprovedWithPeople(
    people: Array<{ id: string; name: string }>,
    entries: ScheduleEntry[],
  ): Promise<void> {
    const now = utcNow();
    const personStatements: D1PreparedStatementLike[] = people.map(person =>
      this.db.prepare(`INSERT INTO people (id, name, relation, created_at, updated_at)
        SELECT ?1, ?2, '', ?3, ?3
        WHERE NOT EXISTS (
          SELECT 1 FROM people WHERE
            lower(replace(name, ' ', '')) = lower(replace(?2, ' ', ''))
            AND id <> ?1
        )
        ON CONFLICT(id) DO NOTHING`).bind(person.id, person.name, now),
    );
    await batchOrThrow(this.db, [
      ...personStatements, ...this.scheduleStatements(entries),
    ]);
  }

  private scheduleStatements(entries: ScheduleEntry[]): D1PreparedStatementLike[] {
    const now = utcNow();
    for (const entry of entries) {
      const minutes = entry.breakMinutes;
      if (minutes != null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 720)) {
        throw new Error('INVALID_BREAK_MINUTES');
      }
    }
    const statements: D1PreparedStatementLike[] = entries.map((entry) => this.db.prepare(
      `INSERT INTO schedules (
        id, person_id, schedule_date, enabled, start_time, end_time,
        break_minutes, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
      ON CONFLICT(person_id, schedule_date) DO UPDATE SET
        enabled = excluded.enabled,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        break_minutes = CASE
          WHEN excluded.enabled = 0 THEN NULL
          WHEN ?9 = 1 THEN excluded.break_minutes
          ELSE schedules.break_minutes END,
        updated_at = excluded.updated_at`,
    ).bind(
      entry.id,
      entry.personId,
      entry.date,
      asInteger(entry.enabled),
      entry.start,
      entry.end,
      entry.enabled === false ? null : (entry.breakMinutes ?? null),
      now,
      entry.breakMinutes === undefined ? 0 : 1,
    ));

    return statements;
  }
}
