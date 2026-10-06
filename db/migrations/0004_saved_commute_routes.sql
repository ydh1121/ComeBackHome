PRAGMA foreign_keys = ON;

CREATE TABLE saved_commute_routes (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1),
  label TEXT NOT NULL,
  origin_access_point_id TEXT REFERENCES transit_access_points(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(person_id, position)
);

CREATE UNIQUE INDEX idx_saved_commute_routes_active
  ON saved_commute_routes(person_id)
  WHERE active = 1;

CREATE INDEX idx_saved_commute_routes_person_position
  ON saved_commute_routes(person_id, position);

CREATE TABLE saved_commute_route_vias (
  route_id TEXT NOT NULL REFERENCES saved_commute_routes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  access_point_id TEXT NOT NULL REFERENCES transit_access_points(id) ON DELETE CASCADE,
  PRIMARY KEY(route_id, position),
  UNIQUE(route_id, access_point_id)
);

INSERT INTO saved_commute_routes (
  id,
  person_id,
  position,
  label,
  origin_access_point_id,
  active,
  created_at,
  updated_at
)
SELECT
  'saved-route:' || person_id || ':1',
  person_id,
  1,
  '경로 1',
  NULL,
  1,
  updated_at,
  updated_at
FROM commute_preferences;

INSERT INTO saved_commute_route_vias (
  route_id,
  position,
  access_point_id
)
SELECT
  'saved-route:' || person_id || ':1',
  position,
  access_point_id
FROM commute_preference_steps;
