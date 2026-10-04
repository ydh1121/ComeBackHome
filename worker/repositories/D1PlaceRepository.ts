import type { PlaceRepository } from '../../src/application/contracts/repositories';
import type { EntityId } from '../../src/domain/common';
import type { Place, PlaceKind } from '../../src/domain/models';
import type { D1DatabaseLike } from '../runtime-types';
import { utcNow } from './d1-helpers';

interface PlaceRow {
  id: string;
  person_id: string;
  kind: PlaceKind;
  label: string;
  road_address: string;
  lot_address: string | null;
  detail_address: string | null;
  latitude: number | null;
  longitude: number | null;
  provider_place_id: string | null;
}

function toPlace(row: PlaceRow): Place {
  return {
    id: row.id,
    personId: row.person_id,
    kind: row.kind,
    label: row.label,
    address: {
      road: row.road_address,
      ...(row.lot_address ? { lot: row.lot_address } : {}),
      ...(row.detail_address ? { detail: row.detail_address } : {}),
    },
    ...(row.latitude === null || row.longitude === null
      ? {}
      : { coordinate: { x: row.longitude, y: row.latitude } }),
    ...(row.provider_place_id ? { providerPlaceId: row.provider_place_id } : {}),
  };
}

export class D1PlaceRepository implements PlaceRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async get(personId: EntityId, kind: PlaceKind): Promise<Place | null> {
    const row = await this.db.prepare(
      `SELECT
        id, person_id, kind, label, road_address, lot_address, detail_address,
        latitude, longitude, provider_place_id
      FROM places
      WHERE person_id = ?1 AND kind = ?2
      LIMIT 1`,
    ).bind(personId, kind).first<PlaceRow>();

    return row ? toPlace(row) : null;
  }

  async save(place: Place): Promise<void> {
    const now = utcNow();
    await this.db.prepare(
      `INSERT INTO places (
        id, person_id, kind, label, road_address, lot_address, detail_address,
        latitude, longitude, provider_place_id, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
      ON CONFLICT(person_id, kind) DO UPDATE SET
        label = excluded.label,
        road_address = excluded.road_address,
        lot_address = excluded.lot_address,
        detail_address = excluded.detail_address,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        provider_place_id = excluded.provider_place_id,
        updated_at = excluded.updated_at`,
    ).bind(
      place.id,
      place.personId,
      place.kind,
      place.label,
      place.address.road,
      place.address.lot ?? null,
      place.address.detail ?? null,
      place.coordinate?.y ?? null,
      place.coordinate?.x ?? null,
      place.providerPlaceId ?? null,
      now,
    ).run();
  }
}
