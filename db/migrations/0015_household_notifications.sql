-- Household reminders contain no ledger amounts, merchant names or memo text.
-- Apply only with the household release; legacy push tables are unchanged.
CREATE TABLE household_notification_projection (
  id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL,
  daily_enabled INTEGER NOT NULL CHECK(daily_enabled IN (0,1)),
  todo_enabled INTEGER NOT NULL CHECK(todo_enabled IN (0,1)),
  reminders_json TEXT NOT NULL CHECK(json_valid(reminders_json))
);
CREATE TABLE household_push_bindings (
  endpoint_hash TEXT PRIMARY KEY, subscription_encrypted TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES auth_users(id), session_hash TEXT NOT NULL,
  auth_epoch INTEGER NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX household_push_user ON household_push_bindings(user_id,active);
CREATE TABLE household_notification_outbox (
  id TEXT PRIMARY KEY, endpoint_hash TEXT NOT NULL REFERENCES household_push_bindings(endpoint_hash),
  event_key TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('ledger','todo')),
  source_id TEXT, due_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','processing','retry','sent','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL,
  lease_until TEXT, claim_token TEXT, sent_at TEXT, error_code TEXT,
  UNIQUE(endpoint_hash,event_key)
);
CREATE INDEX household_notification_due ON household_notification_outbox(status,next_attempt_at);
