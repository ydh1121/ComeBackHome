ALTER TABLE saved_commute_routes ADD COLUMN destination_access_point_id TEXT REFERENCES transit_access_points(id) ON DELETE SET NULL;
