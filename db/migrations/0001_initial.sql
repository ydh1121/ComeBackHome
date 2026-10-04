PRAGMA foreign_keys = ON;

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE places (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('origin', 'destination')),
  label TEXT NOT NULL,
  road_address TEXT NOT NULL DEFAULT '',
  lot_address TEXT,
  detail_address TEXT,
  latitude REAL,
  longitude REAL,
  provider_place_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(person_id, kind)
);

CREATE INDEX idx_places_person_kind ON places(person_id, kind);

CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  schedule_date TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(person_id, schedule_date)
);

CREATE INDEX idx_schedules_person_date ON schedules(person_id, schedule_date);

CREATE TABLE transit_access_points (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  place_kind TEXT NOT NULL CHECK (place_kind IN ('origin', 'destination')),
  provider_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('BUS', 'SUBWAY')),
  canonical_name TEXT NOT NULL,
  user_label TEXT,
  display_code TEXT,
  line TEXT,
  selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),
  selected_bus_route_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(person_id, place_kind, provider_id)
);

CREATE INDEX idx_access_points_person_kind ON transit_access_points(person_id, place_kind);
CREATE INDEX idx_access_points_selected ON transit_access_points(person_id, selected);

CREATE TABLE commute_preferences (
  person_id TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  preferred_route_candidate_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE commute_preference_steps (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  access_point_id TEXT NOT NULL REFERENCES transit_access_points(id) ON DELETE CASCADE,
  PRIMARY KEY(person_id, position),
  UNIQUE(person_id, access_point_id)
);

CREATE TABLE notification_settings (
  id TEXT PRIMARY KEY,
  shift_end_enabled INTEGER NOT NULL DEFAULT 1 CHECK (shift_end_enabled IN (0, 1)),
  eta_change_enabled INTEGER NOT NULL DEFAULT 0 CHECK (eta_change_enabled IN (0, 1)),
  timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',
  updated_at TEXT NOT NULL
);

INSERT INTO notification_settings (
  id,
  shift_end_enabled,
  eta_change_enabled,
  timezone,
  updated_at
) VALUES (
  'default',
  1,
  0,
  'Asia/Seoul',
  '1970-01-01T00:00:00.000Z'
);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  expiration_time INTEGER,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_push_subscriptions_active ON push_subscriptions(active);

CREATE TABLE notification_jobs (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  person_id TEXT REFERENCES people(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'sent', 'retry', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  sent_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_notification_jobs_due
  ON notification_jobs(status, next_attempt_at, scheduled_for);

CREATE INDEX idx_notification_jobs_person
  ON notification_jobs(person_id, scheduled_for);
