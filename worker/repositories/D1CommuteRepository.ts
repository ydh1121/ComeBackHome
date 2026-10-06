import type { CommuteRepository } from '../../src/application/contracts/repositories';
import type { EntityId } from '../../src/domain/common';
import type { PlaceKind, RouteCandidate, RoutePreference, SavedCommuteRoute, TransitAccessPoint } from '../../src/domain/models';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../runtime-types';
import { asBoolean, asInteger, batchOrThrow, utcNow } from './d1-helpers';

interface AccessPointRow {
  id: string;
  person_id: string;
  place_kind: PlaceKind;
  provider_id: string;
  mode: 'BUS' | 'SUBWAY';
  canonical_name: string;
  user_label: string | null;
  display_code: string | null;
  line: string | null;
  selected: number;
  selected_bus_route_id: string | null;
}

interface RoutePreferenceRow {
  person_id: string;
  preferred_route_candidate_id: string | null;
}

interface RouteStepRow {
  access_point_id: string;
}

interface SavedRouteRow {
  id: string;
  person_id: string;
  position: number;
  label: string;
  origin_access_point_id: string | null;
  active: number;
}

interface SavedRouteViaRow {
  route_id: string;
  access_point_id: string;
}

function toAccessPoint(row: AccessPointRow): TransitAccessPoint {
  return {
    id: row.id,
    personId: row.person_id,
    providerId: row.provider_id,
    placeKind: row.place_kind,
    mode: row.mode,
    name: row.canonical_name,
    selected: asBoolean(row.selected),
    ...(row.user_label ? { userLabel: row.user_label } : {}),
    ...(row.display_code ? { displayCode: row.display_code } : {}),
    ...(row.line ? { line: row.line } : {}),
    ...(row.selected_bus_route_id ? { selectedBusRouteId: row.selected_bus_route_id } : {}),
  };
}

export class D1CommuteRepository implements CommuteRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async listAccessPoints(personId: EntityId, kind: PlaceKind): Promise<TransitAccessPoint[]> {
    const result = await this.db.prepare(
      `SELECT
        id, person_id, place_kind, provider_id, mode, canonical_name, user_label,
        display_code, line, selected, selected_bus_route_id
      FROM transit_access_points
      WHERE person_id = ?1 AND place_kind = ?2
      ORDER BY selected DESC, canonical_name ASC, id ASC`,
    ).bind(personId, kind).all<AccessPointRow>();
    return result.results.map(toAccessPoint);
  }

  async upsertAccessPoint(point: TransitAccessPoint): Promise<void> {
    const now = utcNow();
    await this.db.prepare(
      `INSERT INTO transit_access_points (
        id, person_id, place_kind, provider_id, mode, canonical_name, user_label,
        display_code, line, selected, selected_bus_route_id, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
      ON CONFLICT(person_id, place_kind, provider_id) DO UPDATE SET
        mode = excluded.mode,
        canonical_name = excluded.canonical_name,
        user_label = excluded.user_label,
        display_code = excluded.display_code,
        line = excluded.line,
        selected = excluded.selected,
        selected_bus_route_id = excluded.selected_bus_route_id,
        updated_at = excluded.updated_at`,
    ).bind(
      point.id,
      point.personId,
      point.placeKind,
      point.providerId,
      point.mode,
      point.name,
      point.userLabel ?? null,
      point.displayCode ?? null,
      point.line ?? null,
      asInteger(point.selected),
      point.selectedBusRouteId ?? null,
      now,
    ).run();
  }

  async setAccessPointSelected(accessPointId: EntityId, selected: boolean): Promise<void> {
    await this.db.prepare(
      'UPDATE transit_access_points SET selected = ?2, updated_at = ?3 WHERE id = ?1',
    ).bind(accessPointId, asInteger(selected), utcNow()).run();
  }

  async setAccessPointAlias(accessPointId: EntityId, userLabel: string): Promise<void> {
    await this.db.prepare(
      'UPDATE transit_access_points SET user_label = ?2, updated_at = ?3 WHERE id = ?1',
    ).bind(accessPointId, userLabel || null, utcNow()).run();
  }

  async setSelectedBusRoute(accessPointId: EntityId, providerRouteId: string): Promise<void> {
    await this.db.prepare(
      'UPDATE transit_access_points SET selected_bus_route_id = ?2, updated_at = ?3 WHERE id = ?1',
    ).bind(accessPointId, providerRouteId, utcNow()).run();
  }

  async getRoutePreference(personId: EntityId): Promise<RoutePreference | null> {
    const preference = await this.db.prepare(
      'SELECT person_id, preferred_route_candidate_id FROM commute_preferences WHERE person_id = ?1 LIMIT 1',
    ).bind(personId).first<RoutePreferenceRow>();
    if (!preference) return null;

    const steps = await this.db.prepare(
      'SELECT access_point_id FROM commute_preference_steps WHERE person_id = ?1 ORDER BY position ASC',
    ).bind(personId).all<RouteStepRow>();

    return {
      id: 'route-pref:' + personId,
      personId,
      originPlaceKind: 'origin',
      destinationPlaceKind: 'destination',
      viaAccessPointIds: steps.results.map((row) => row.access_point_id),
    };
  }

  async saveRoutePreference(preference: RoutePreference): Promise<void> {
    const now = utcNow();
    const statements: D1PreparedStatementLike[] = [
      this.db.prepare(
        `INSERT INTO commute_preferences (person_id, preferred_route_candidate_id, updated_at)
        VALUES (?1, NULL, ?2)
        ON CONFLICT(person_id) DO UPDATE SET updated_at = excluded.updated_at`,
      ).bind(preference.personId, now),
      this.db.prepare(
        'DELETE FROM commute_preference_steps WHERE person_id = ?1',
      ).bind(preference.personId),
      ...preference.viaAccessPointIds.map((accessPointId, position) => this.db.prepare(
        `INSERT INTO commute_preference_steps (person_id, position, access_point_id)
        VALUES (?1, ?2, ?3)`,
      ).bind(preference.personId, position, accessPointId)),
    ];

    await batchOrThrow(this.db, statements);
  }

  async listSavedRoutes(personId: EntityId): Promise<SavedCommuteRoute[]> {
    const routeResult = await this.db.prepare(
      `SELECT id, person_id, position, label, origin_access_point_id, active
      FROM saved_commute_routes
      WHERE person_id = ?1
      ORDER BY position ASC, id ASC`,
    ).bind(personId).all<SavedRouteRow>();

    const viaResult = await this.db.prepare(
      `SELECT route_id, access_point_id
      FROM saved_commute_route_vias
      WHERE route_id IN (
        SELECT id FROM saved_commute_routes WHERE person_id = ?1
      )
      ORDER BY route_id ASC, position ASC`,
    ).bind(personId).all<SavedRouteViaRow>();

    const viasByRoute = new Map<string, string[]>();
    for (const row of viaResult.results) {
      const ids = viasByRoute.get(row.route_id) ?? [];
      ids.push(row.access_point_id);
      viasByRoute.set(row.route_id, ids);
    }

    return routeResult.results.map((row) => ({
      id: row.id,
      personId: row.person_id,
      position: row.position,
      label: row.label,
      ...(row.origin_access_point_id ? { originAccessPointId: row.origin_access_point_id } : {}),
      viaAccessPointIds: viasByRoute.get(row.id) ?? [],
      active: asBoolean(row.active),
    }));
  }

  async createSavedRoute(personId: EntityId): Promise<SavedCommuteRoute> {
    const routes = await this.listSavedRoutes(personId);
    const position = Math.max(0, ...routes.map((route) => route.position)) + 1;
    const route: SavedCommuteRoute = {
      id: crypto.randomUUID(),
      personId,
      position,
      label: '경로 ' + position,
      viaAccessPointIds: [],
      active: routes.length === 0,
    };
    await this.saveSavedRoute(route);
    return route;
  }

  async saveSavedRoute(route: SavedCommuteRoute): Promise<void> {
    const now = utcNow();
    const statements: D1PreparedStatementLike[] = [];

    if (route.active) {
      statements.push(
        this.db.prepare(
          'UPDATE saved_commute_routes SET active = 0, updated_at = ?2 WHERE person_id = ?1',
        ).bind(route.personId, now),
      );
    }

    statements.push(
      this.db.prepare(
        `INSERT INTO saved_commute_routes (
          id, person_id, position, label, origin_access_point_id, active, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
        ON CONFLICT(id) DO UPDATE SET
          position = excluded.position,
          label = excluded.label,
          origin_access_point_id = excluded.origin_access_point_id,
          active = excluded.active,
          updated_at = excluded.updated_at`,
      ).bind(
        route.id,
        route.personId,
        route.position,
        route.label,
        route.originAccessPointId ?? null,
        asInteger(route.active),
        now,
      ),
      this.db.prepare(
        'DELETE FROM saved_commute_route_vias WHERE route_id = ?1',
      ).bind(route.id),
      ...route.viaAccessPointIds.map((accessPointId, position) => this.db.prepare(
        `INSERT INTO saved_commute_route_vias (route_id, position, access_point_id)
        VALUES (?1, ?2, ?3)`,
      ).bind(route.id, position, accessPointId)),
    );

    if (route.active) {
      statements.push(
        this.db.prepare(
          `INSERT INTO commute_preferences (person_id, preferred_route_candidate_id, updated_at)
          VALUES (?1, NULL, ?2)
          ON CONFLICT(person_id) DO UPDATE SET
            preferred_route_candidate_id = NULL,
            updated_at = excluded.updated_at`,
        ).bind(route.personId, now),
        this.db.prepare(
          'DELETE FROM commute_preference_steps WHERE person_id = ?1',
        ).bind(route.personId),
        ...route.viaAccessPointIds.map((accessPointId, position) => this.db.prepare(
          `INSERT INTO commute_preference_steps (person_id, position, access_point_id)
          VALUES (?1, ?2, ?3)`,
        ).bind(route.personId, position, accessPointId)),
      );
    }

    await batchOrThrow(this.db, statements);
  }

  async setActiveSavedRoute(personId: EntityId, routeId: EntityId): Promise<void> {
    const route = (await this.listSavedRoutes(personId)).find((candidate) => candidate.id === routeId);
    if (!route) throw new Error('Saved commute route was not found.');
    await this.saveSavedRoute({ ...route, active: true });
  }

  async listRouteCandidates(_personId: EntityId): Promise<RouteCandidate[]> {
    return [];
  }

  async getPreferredRouteCandidateId(personId: EntityId): Promise<EntityId | null> {
    const row = await this.db.prepare(
      'SELECT preferred_route_candidate_id FROM commute_preferences WHERE person_id = ?1 LIMIT 1',
    ).bind(personId).first<{ preferred_route_candidate_id: string | null }>();
    return row?.preferred_route_candidate_id ?? null;
  }

  async setPreferredRouteCandidateId(personId: EntityId, routeCandidateId: EntityId): Promise<void> {
    await this.db.prepare(
      `INSERT INTO commute_preferences (person_id, preferred_route_candidate_id, updated_at)
      VALUES (?1, ?2, ?3)
      ON CONFLICT(person_id) DO UPDATE SET
        preferred_route_candidate_id = excluded.preferred_route_candidate_id,
        updated_at = excluded.updated_at`,
    ).bind(personId, routeCandidateId, utcNow()).run();
  }
}
