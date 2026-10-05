CREATE TABLE notification_planner_state (
  person_id TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  eta_baseline_at TEXT,
  eta_baseline_work_date TEXT,
  last_eta_notification_at TEXT,
  updated_at TEXT NOT NULL
);
