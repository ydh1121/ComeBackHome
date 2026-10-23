-- Additive only. Apply locally/CI; production application requires owner approval.
PRAGMA foreign_keys = ON;
CREATE TABLE auth_users (
  id TEXT PRIMARY KEY, login_id TEXT NOT NULL UNIQUE CHECK(login_id IN ('ydh1121','yvonne')),
  role TEXT NOT NULL CHECK(role IN ('admin','member')), disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)),
  must_change_password INTEGER NOT NULL DEFAULT 1 CHECK(must_change_password IN (0,1)),
  auth_epoch INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  CHECK((login_id='ydh1121' AND role='admin') OR (login_id='yvonne' AND role='member'))
);
CREATE TABLE auth_credentials (
  user_id TEXT PRIMARY KEY REFERENCES auth_users(id), algorithm TEXT NOT NULL CHECK(algorithm='pbkdf2-sha256'),
  iterations INTEGER NOT NULL CHECK(iterations>=600000), salt_b64 TEXT NOT NULL, hash_b64 TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE auth_policy (
  id TEXT PRIMARY KEY CHECK(id='default'), session_hours INTEGER NOT NULL CHECK(session_hours BETWEEN 1 AND 24),
  remembered_days INTEGER NOT NULL CHECK(remembered_days BETWEEN 1 AND 30), idle_hours INTEGER NOT NULL CHECK(idle_hours BETWEEN 1 AND 720)
);
INSERT INTO auth_policy VALUES ('default',12,30,168);
CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES auth_users(id), auth_epoch INTEGER NOT NULL,
  device_name TEXT NOT NULL, remembered INTEGER NOT NULL CHECK(remembered IN (0,1)),
  issued_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
);
CREATE INDEX auth_session_user ON auth_sessions(user_id, expires_at);
CREATE TABLE auth_rate_limits (key_hash TEXT PRIMARY KEY, window_start INTEGER NOT NULL, attempts INTEGER NOT NULL);
CREATE TABLE auth_preferences (user_id TEXT PRIMARY KEY REFERENCES auth_users(id), shortcut_visible INTEGER NOT NULL DEFAULT 1 CHECK(shortcut_visible IN (0,1)), updated_at TEXT NOT NULL);
-- Explicit, owner-approved membership of the existing shared application. No implicit role grant.
CREATE TABLE auth_workspace_grants (user_id TEXT PRIMARY KEY REFERENCES auth_users(id), workspace TEXT NOT NULL CHECK(workspace='legacy'), permission TEXT NOT NULL CHECK(permission IN ('read','write')), approved_at TEXT NOT NULL);
CREATE TABLE auth_audit (id TEXT PRIMARY KEY, actor_id TEXT, action TEXT NOT NULL, outcome TEXT NOT NULL, target_id TEXT, created_at TEXT NOT NULL);
CREATE INDEX auth_audit_time ON auth_audit(created_at);

CREATE TABLE case_profiles (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL UNIQUE REFERENCES auth_users(id), created_at TEXT NOT NULL
);
CREATE TRIGGER case_owner_is_member BEFORE INSERT ON case_profiles
WHEN NOT EXISTS(SELECT 1 FROM auth_users WHERE id=NEW.owner_id AND login_id='yvonne' AND role='member')
BEGIN SELECT RAISE(ABORT,'INVALID_CASE_OWNER'); END;
CREATE TRIGGER case_owner_immutable BEFORE UPDATE OF owner_id ON case_profiles
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CASE_OWNER'); END;
CREATE TABLE case_consents (
  case_id TEXT PRIMARY KEY REFERENCES case_profiles(id), admin_access INTEGER NOT NULL DEFAULT 0 CHECK(admin_access IN (0,1)),
  purpose TEXT NOT NULL DEFAULT '', retention TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL REFERENCES auth_users(id), updated_at TEXT NOT NULL
);
CREATE TABLE case_records (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES case_profiles(id), kind TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), revision INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL REFERENCES auth_users(id), updated_at TEXT NOT NULL, archived_at TEXT
);
CREATE INDEX case_records_kind ON case_records(case_id,kind,updated_at);
CREATE TABLE case_revisions (
  record_id TEXT NOT NULL REFERENCES case_records(id), revision INTEGER NOT NULL, case_id TEXT NOT NULL REFERENCES case_profiles(id),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), author_id TEXT NOT NULL REFERENCES auth_users(id), created_at TEXT NOT NULL,
  PRIMARY KEY(record_id,revision)
);
CREATE TRIGGER case_record_initial AFTER INSERT ON case_records BEGIN
  INSERT INTO case_revisions VALUES(NEW.id,NEW.revision,NEW.case_id,NEW.payload_json,NEW.updated_by,NEW.updated_at);
END;
CREATE TRIGGER case_record_update AFTER UPDATE ON case_records BEGIN
  INSERT INTO case_revisions VALUES(NEW.id,NEW.revision,NEW.case_id,NEW.payload_json,NEW.updated_by,NEW.updated_at);
END;
CREATE TRIGGER case_revision_immutable_update BEFORE UPDATE ON case_revisions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_REVISION'); END;
CREATE TRIGGER case_revision_immutable_delete BEFORE DELETE ON case_revisions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_REVISION'); END;
CREATE TABLE case_payment_events (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES case_profiles(id), claim_id TEXT NOT NULL REFERENCES case_records(id),
  event_type TEXT NOT NULL CHECK(event_type IN ('decision','deposit','decision_adjustment','refund')),
  amount INTEGER NOT NULL CHECK(amount BETWEEN -100000000000 AND 100000000000), recognized_days INTEGER NOT NULL DEFAULT 0,
  event_date TEXT NOT NULL, source_record_id TEXT NOT NULL REFERENCES case_records(id), corrects_id TEXT REFERENCES case_payment_events(id),
  dedupe_key TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES auth_users(id), created_at TEXT NOT NULL,
  UNIQUE(case_id,dedupe_key)
);
CREATE TRIGGER case_payment_immutable_update BEFORE UPDATE ON case_payment_events BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PAYMENT'); END;
CREATE TRIGGER case_payment_immutable_delete BEFORE DELETE ON case_payment_events BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PAYMENT'); END;
CREATE TABLE case_policies (
  id TEXT PRIMARY KEY, policy_key TEXT NOT NULL, version TEXT NOT NULL, effective_from TEXT NOT NULL, effective_to TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('proposed','enacted','effective')), source_url TEXT NOT NULL,
  checked_at TEXT NOT NULL, values_json TEXT NOT NULL CHECK(json_valid(values_json)), created_by TEXT NOT NULL REFERENCES auth_users(id),
  created_at TEXT NOT NULL, UNIQUE(policy_key,version)
);
CREATE TRIGGER case_policy_immutable_update BEFORE UPDATE ON case_policies BEGIN SELECT RAISE(ABORT,'IMMUTABLE_POLICY'); END;
CREATE TRIGGER case_policy_immutable_delete BEFORE DELETE ON case_policies BEGIN SELECT RAISE(ABORT,'IMMUTABLE_POLICY'); END;
CREATE TABLE case_documents (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES case_profiles(id), filename TEXT NOT NULL, mime TEXT NOT NULL,
  bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, drive_file_id TEXT, drive_revision TEXT, folder_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','uploading','verifying','ready','failed','missing','trashed')),
  session_encrypted TEXT, created_by TEXT NOT NULL REFERENCES auth_users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(case_id,sha256,bytes)
);
CREATE TABLE case_drive_connections (
  case_id TEXT PRIMARY KEY REFERENCES case_profiles(id), refresh_token_encrypted TEXT NOT NULL,
  google_subject TEXT NOT NULL, folder_id TEXT NOT NULL, permission_ids_json TEXT NOT NULL,
  connected_by TEXT NOT NULL REFERENCES auth_users(id), connected_at TEXT NOT NULL
);
CREATE TABLE case_oauth_states (
  state_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES auth_users(id), session_hash TEXT NOT NULL,
  verifier_encrypted TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE case_audit (
  id TEXT PRIMARY KEY, case_id TEXT REFERENCES case_profiles(id), actor_id TEXT NOT NULL REFERENCES auth_users(id),
  action TEXT NOT NULL, target_id TEXT, outcome TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX case_audit_case ON case_audit(case_id,created_at);
CREATE TRIGGER case_record_audit_insert AFTER INSERT ON case_records BEGIN
  INSERT INTO case_audit VALUES(lower(hex(randomblob(16))),NEW.case_id,NEW.updated_by,'record-create',NEW.id,'allowed',NEW.updated_at);
END;
CREATE TRIGGER case_record_audit_update AFTER UPDATE ON case_records BEGIN
  INSERT INTO case_audit VALUES(lower(hex(randomblob(16))),NEW.case_id,NEW.updated_by,'record-revision',NEW.id,'allowed',NEW.updated_at);
END;

CREATE TRIGGER case_payment_audit AFTER INSERT ON case_payment_events BEGIN
  INSERT INTO case_audit VALUES(lower(hex(randomblob(16))),NEW.case_id,NEW.created_by,'payment',NEW.id,'allowed',NEW.created_at);
END;
CREATE TRIGGER case_consent_audit AFTER UPDATE ON case_consents BEGIN
  INSERT INTO case_audit VALUES(lower(hex(randomblob(16))),NEW.case_id,NEW.updated_by,'consent-change',NULL,'allowed',NEW.updated_at);
END;
