-- Local/CI only until owner approves production migration and release.
ALTER TABLE notification_settings ADD COLUMN arrival_advance_enabled INTEGER NOT NULL DEFAULT 1 CHECK (arrival_advance_enabled IN (0, 1));
CREATE TABLE notification_arrival_plan (
  person_id TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  arrival_at TEXT,
  shift_start TEXT,
  shift_end TEXT,
  checked_at TEXT NOT NULL
);
