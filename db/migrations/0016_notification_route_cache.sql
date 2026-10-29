-- Private scheduler cache. No change to schedules, presence or notification jobs.
CREATE TABLE notification_route_cache (
  person_id TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  context_hash TEXT NOT NULL,
  route_json TEXT,
  fetched_at TEXT,
  expires_at TEXT NOT NULL,
  retry_after TEXT NOT NULL,
  lease_until TEXT NOT NULL,
  lease_token TEXT,
  request_day TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0)
);
