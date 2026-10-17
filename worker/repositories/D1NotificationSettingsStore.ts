import type { NotificationSettingsRecord, NotificationSettingsStore } from '../contracts';
import type { D1DatabaseLike } from '../runtime-types';
import { asBoolean, asInteger, utcNow } from './d1-helpers';

interface NotificationSettingsRow {
  arrival_advance_enabled: number;
  shift_end_enabled: number;
  eta_change_enabled: number;
  left_work_enabled: number;
  home_arrival_enabled: number;
  timezone: string;
  updated_at: string;
}

function toRecord(row: NotificationSettingsRow): NotificationSettingsRecord {
  return {
    arrivalAdvanceEnabled: asBoolean(row.arrival_advance_enabled),
    shiftEndEnabled: asBoolean(row.shift_end_enabled),
    etaChangeEnabled: asBoolean(row.eta_change_enabled),
    leftWorkEnabled: asBoolean(row.left_work_enabled),
    homeArrivalEnabled: asBoolean(row.home_arrival_enabled),
    timezone: row.timezone,
    updatedAt: row.updated_at,
  };
}

export class D1NotificationSettingsStore implements NotificationSettingsStore {
  constructor(private readonly db: D1DatabaseLike) {}

  async get(): Promise<NotificationSettingsRecord> {
    const row = await this.db.prepare(
      `SELECT
        arrival_advance_enabled,
        shift_end_enabled,
        eta_change_enabled,
        left_work_enabled,
        home_arrival_enabled,
        timezone,
        updated_at
      FROM notification_settings
      WHERE id = 'default'
      LIMIT 1`,
    ).first<NotificationSettingsRow>();

    if (!row) throw new Error('Notification settings row is missing.');
    return toRecord(row);
  }

  async updateRules(input: Pick<NotificationSettingsRecord, 'shiftEndEnabled' | 'etaChangeEnabled' | 'leftWorkEnabled' | 'homeArrivalEnabled' | 'arrivalAdvanceEnabled'>): Promise<NotificationSettingsRecord> {
    const now = utcNow();
    await this.db.prepare(
      `UPDATE notification_settings
      SET
        shift_end_enabled = ?1,
        eta_change_enabled = ?2,
        left_work_enabled = ?3,
        home_arrival_enabled = ?4,
        updated_at = ?5,
        arrival_advance_enabled = COALESCE(?6, arrival_advance_enabled)
      WHERE id = 'default'`,
    ).bind(
      asInteger(input.shiftEndEnabled),
      asInteger(input.etaChangeEnabled),
      asInteger(input.leftWorkEnabled),
      asInteger(input.homeArrivalEnabled),
      now,
      input.arrivalAdvanceEnabled === undefined ? null : asInteger(input.arrivalAdvanceEnabled),
    ).run();

    return this.get();
  }
}
