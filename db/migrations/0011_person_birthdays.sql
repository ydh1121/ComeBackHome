-- Additive only. Production application requires explicit owner approval.
ALTER TABLE people ADD COLUMN phone TEXT;
ALTER TABLE people ADD COLUMN birthday_json TEXT CHECK (birthday_json IS NULL OR json_valid(birthday_json));
ALTER TABLE notification_settings ADD COLUMN birthday_days_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(birthday_days_json));
