-- Private Drive mailbox metadata only. Existing case records and originals remain unchanged.
CREATE TABLE case_chat_exchanges (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES case_profiles(id),
  created_by TEXT NOT NULL REFERENCES auth_users(id),
  sources_json TEXT NOT NULL CHECK(json_valid(sources_json)),
  source_fingerprint TEXT NOT NULL,
  question TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  drive_file_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('preparing','waiting','ready')),
  lease_until TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX case_chat_exchanges_case ON case_chat_exchanges(case_id,created_at DESC);
