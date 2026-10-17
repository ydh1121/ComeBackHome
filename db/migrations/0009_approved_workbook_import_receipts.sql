-- Atomic, durable, idempotent NON-IMAGE workbook approvals.
-- Run against isolated LOCAL D1 only until user approves production migration.
CREATE TABLE IF NOT EXISTS approved_workbook_import_receipts (
  request_id TEXT PRIMARY KEY,
  payload_digest TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- Declarative assertion rows are written in the SAME D1.batch transaction.
-- CHECK aborts the entire batch if any reviewed schedule changed since inspection.
CREATE TABLE IF NOT EXISTS approved_workbook_import_checks (
  request_id TEXT NOT NULL REFERENCES approved_workbook_import_receipts(request_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  passed INTEGER NOT NULL CHECK(passed = 1),
  PRIMARY KEY (request_id, ordinal)
);
-- Existing duplicates are left alone. Reject NEW duplicate names for both
-- ordinary people routes and approved imports; do not duplicate employee IDs.
CREATE TRIGGER IF NOT EXISTS cbh_people_reject_duplicate_insert
BEFORE INSERT ON people
WHEN EXISTS (
  SELECT 1 FROM people
  WHERE lower(replace(trim(name), ' ', '')) =
        lower(replace(trim(NEW.name), ' ', ''))
)
BEGIN
  SELECT RAISE(ABORT, 'DUPLICATE_PERSON_NAME');
END;
CREATE TRIGGER IF NOT EXISTS cbh_people_reject_duplicate_update
BEFORE UPDATE OF name ON people
WHEN EXISTS (
  SELECT 1 FROM people
  WHERE id <> OLD.id AND lower(replace(trim(name), ' ', '')) =
        lower(replace(trim(NEW.name), ' ', ''))
)
BEGIN
  SELECT RAISE(ABORT, 'DUPLICATE_PERSON_NAME');
END;
