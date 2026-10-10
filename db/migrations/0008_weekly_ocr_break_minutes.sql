-- ComeBackHome weekly OCR break minutes. Reviewed values only.
-- Local CI migration is allowed; NEVER execute against remote D1 without approval.
-- Nullable for pre-existing rows, manual entries and legacy XLSX imports.
ALTER TABLE schedules ADD COLUMN break_minutes INTEGER
  CHECK (break_minutes IS NULL OR (break_minutes BETWEEN 0 AND 720));
