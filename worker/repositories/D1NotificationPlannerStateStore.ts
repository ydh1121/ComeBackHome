import type {
  NotificationPlannerState,
  NotificationPlannerStateStore,
} from '../contracts';
import type { D1DatabaseLike } from '../runtime-types';

interface PlannerStateRow {
  person_id: string;
  eta_baseline_at: string | null;
  eta_baseline_work_date: string | null;
  last_eta_notification_at: string | null;
  updated_at: string;
}

function toState(row: PlannerStateRow): NotificationPlannerState {
  return {
    personId: row.person_id,
    etaBaselineAt: row.eta_baseline_at,
    etaBaselineWorkDate: row.eta_baseline_work_date,
    lastEtaNotificationAt: row.last_eta_notification_at,
    updatedAt: row.updated_at,
  };
}

export class D1NotificationPlannerStateStore implements NotificationPlannerStateStore {
  constructor(private readonly db: D1DatabaseLike) {}

  async get(personId: string): Promise<NotificationPlannerState | null> {
    const row = await this.db.prepare(
      `SELECT person_id, eta_baseline_at, eta_baseline_work_date, last_eta_notification_at, updated_at
      FROM notification_planner_state
      WHERE person_id = ?1
      LIMIT 1`,
    ).bind(personId).first<PlannerStateRow>();

    return row ? toState(row) : null;
  }

  async upsert(state: NotificationPlannerState): Promise<void> {
    await this.db.prepare(
      `INSERT INTO notification_planner_state (
        person_id, eta_baseline_at, eta_baseline_work_date, last_eta_notification_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT(person_id) DO UPDATE SET
        eta_baseline_at = excluded.eta_baseline_at,
        eta_baseline_work_date = excluded.eta_baseline_work_date,
        last_eta_notification_at = excluded.last_eta_notification_at,
        updated_at = excluded.updated_at`,
    ).bind(
      state.personId,
      state.etaBaselineAt,
      state.etaBaselineWorkDate,
      state.lastEtaNotificationAt,
      state.updatedAt,
    ).run();
  }
}
