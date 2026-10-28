-- Additive coordination only. Financial records live in the private Drive spreadsheet.
CREATE TABLE household_workspace (
 id TEXT PRIMARY KEY CHECK(id='shared'),
 root_id TEXT NOT NULL,
 connection_case_id TEXT NOT NULL REFERENCES case_profiles(id),
 spreadsheet_id TEXT,
 initialization_id TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 state_hash TEXT,
 pending_id TEXT,
 pending_encrypted TEXT,
 lease_token TEXT,
 lease_until TEXT,
 updated_at TEXT NOT NULL,
 CHECK ((pending_id IS NULL) = (pending_encrypted IS NULL))
);
-- Bounded upload receipts contain metadata only, never image bytes or card numbers.
CREATE TABLE household_card_uploads (
 operation_id TEXT PRIMARY KEY, card_id TEXT NOT NULL, file_id TEXT NOT NULL UNIQUE,
 sha256 TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 5242880),
 mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/webp')),
 created_at TEXT NOT NULL, completed_at TEXT
);
