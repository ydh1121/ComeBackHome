ALTER TABLE transit_access_points ADD COLUMN coordinate_x REAL;
ALTER TABLE transit_access_points ADD COLUMN coordinate_y REAL;
ALTER TABLE transit_access_points ADD COLUMN distance_m INTEGER;
ALTER TABLE transit_access_points ADD COLUMN walk_minutes INTEGER;

CREATE TABLE IF NOT EXISTS saved_commute_route_origins (
  route_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  access_point_id TEXT NOT NULL,
  PRIMARY KEY (route_id, position),
  FOREIGN KEY (route_id) REFERENCES saved_commute_routes(id) ON DELETE CASCADE,
  FOREIGN KEY (access_point_id) REFERENCES transit_access_points(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_saved_commute_route_origins_access
  ON saved_commute_route_origins(access_point_id);

CREATE TABLE IF NOT EXISTS saved_commute_route_destinations (
  route_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  access_point_id TEXT NOT NULL,
  PRIMARY KEY (route_id, position),
  FOREIGN KEY (route_id) REFERENCES saved_commute_routes(id) ON DELETE CASCADE,
  FOREIGN KEY (access_point_id) REFERENCES transit_access_points(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_saved_commute_route_destinations_access
  ON saved_commute_route_destinations(access_point_id);

INSERT OR IGNORE INTO saved_commute_route_origins (route_id, position, access_point_id)
SELECT id, 0, origin_access_point_id
FROM saved_commute_routes
WHERE origin_access_point_id IS NOT NULL;

INSERT OR IGNORE INTO saved_commute_route_destinations (route_id, position, access_point_id)
SELECT id, 0, destination_access_point_id
FROM saved_commute_routes
WHERE destination_access_point_id IS NOT NULL;
