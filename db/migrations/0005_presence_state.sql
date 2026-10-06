PRAGMA foreign_keys = ON;

CREATE TABLE presence_events (
  event_id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('LEFT_WORK', 'ARRIVED_HOME')),
  work_date TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_presence_events_person_date
  ON presence_events(person_id, work_date, accepted_at);

CREATE TABLE presence_state (
  person_id TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  left_work_at TEXT,
  arrived_home_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_presence_state_work_date
  ON presence_state(work_date);
