ALTER TABLE notification_settings
ADD COLUMN left_work_enabled INTEGER NOT NULL DEFAULT 1 CHECK (left_work_enabled IN (0, 1));

ALTER TABLE notification_settings
ADD COLUMN home_arrival_enabled INTEGER NOT NULL DEFAULT 1 CHECK (home_arrival_enabled IN (0, 1));
