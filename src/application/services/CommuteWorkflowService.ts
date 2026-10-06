import type { EntityId } from '../../domain/common';
import type { BusRouteOption, PlaceKind, RoutePreference, SavedCommuteRoute, TransitAccessPoint } from '../../domain/models';
import type { BusRouteActions, CommuteActions, PlaceActions, PlaceInput, TransitSearchActions } from '../contracts/actions';
import type { PlaceSearchProvider, TransitAccessSearchProvider, TransitRouteProvider, TransitSearchResult } from '../contracts/providers';
import type { CommuteRepository, PlaceRepository } from '../contracts/repositories';

export class PlaceService implements PlaceActions {
  constructor(
    private readonly places: PlaceRepository,
    private readonly searchProvider: PlaceSearchProvider,
  ) {}

  search(query: string) {
    const trimmed = query.trim();
    return trimmed.length >= 2 ? this.searchProvider.search(trimmed) : Promise.resolve([]);
  }

  async save(personId: EntityId, kind: PlaceKind, input: PlaceInput) {
    const current = await this.places.get(personId, kind);
    const place = {
      id: current?.id ?? crypto.randomUUID(),
      personId,
      kind,
      label: input.label.trim() || current?.label || (kind === 'origin' ? '출발지' : '도착지'),
      address: input.address,
      coordinate: input.coordinate,
      providerPlaceId: input.providerPlaceId,
    };
    await this.places.save(place);
    return place;
  }
}

export class CommuteService implements CommuteActions {
  constructor(private readonly commute: CommuteRepository) {}

  selectRouteCandidate(personId: EntityId, routeCandidateId: EntityId) {
    return this.commute.setPreferredRouteCandidateId(personId, routeCandidateId);
  }

  createSavedRoute(personId: EntityId): Promise<SavedCommuteRoute> {
    return this.commute.createSavedRoute(personId);
  }

  selectSavedRoute(personId: EntityId, routeId: EntityId): Promise<void> {
    return this.commute.setActiveSavedRoute(personId, routeId);
  }

  async setRouteOriginAccess(personId: EntityId, routeId: EntityId, accessPointId: EntityId): Promise<void> {
    const route = await this.requireSavedRoute(personId, routeId);
    await this.commute.saveSavedRoute({ ...route, originAccessPointId: accessPointId });
  }

  async moveRouteVia(personId: EntityId, routeId: EntityId, fromIndex: number, toIndex: number): Promise<void> {
    const route = await this.requireSavedRoute(personId, routeId);
    const ids = [...route.viaAccessPointIds];
    if (fromIndex < 0 || fromIndex >= ids.length) return;
    const [item] = ids.splice(fromIndex, 1);
    const target = Math.max(0, Math.min(toIndex, ids.length));
    ids.splice(target, 0, item);
    await this.commute.saveSavedRoute({ ...route, viaAccessPointIds: ids });
  }

  async addRouteVia(personId: EntityId, routeId: EntityId, accessPointId: EntityId, index?: number): Promise<void> {
    const route = await this.requireSavedRoute(personId, routeId);
    const ids = route.viaAccessPointIds.filter((id) => id !== accessPointId);
    const target = index == null ? ids.length : Math.max(0, Math.min(index, ids.length));
    ids.splice(target, 0, accessPointId);
    await this.commute.saveSavedRoute({ ...route, viaAccessPointIds: ids });
  }

  async replaceRouteVia(personId: EntityId, routeId: EntityId, index: number, accessPointId: EntityId): Promise<void> {
    const route = await this.requireSavedRoute(personId, routeId);
    const ids = [...route.viaAccessPointIds];
    if (index < 0 || index >= ids.length) return;
    ids[index] = accessPointId;
    await this.commute.saveSavedRoute({ ...route, viaAccessPointIds: ids });
  }

  async removeRouteVia(personId: EntityId, routeId: EntityId, index: number): Promise<void> {
    const route = await this.requireSavedRoute(personId, routeId);
    const ids = [...route.viaAccessPointIds];
    if (index < 0 || index >= ids.length) return;
    ids.splice(index, 1);
    await this.commute.saveSavedRoute({ ...route, viaAccessPointIds: ids });
  }

  async movePreferenceStep(personId: EntityId, fromIndex: number, toIndex: number): Promise<void> {
    const preference = await this.ensurePreference(personId);
    const ids = [...preference.viaAccessPointIds];
    if (fromIndex < 0 || fromIndex >= ids.length) return;
    const [item] = ids.splice(fromIndex, 1);
    const target = Math.max(0, Math.min(toIndex, ids.length));
    ids.splice(target, 0, item);
    await this.commute.saveRoutePreference({ ...preference, viaAccessPointIds: ids });
  }

  async addPreferenceStep(personId: EntityId, accessPointId: EntityId, index?: number): Promise<void> {
    const preference = await this.ensurePreference(personId);
    const ids = preference.viaAccessPointIds.filter((id) => id !== accessPointId);
    const target = index == null ? ids.length : Math.max(0, Math.min(index, ids.length));
    ids.splice(target, 0, accessPointId);
    await this.commute.saveRoutePreference({ ...preference, viaAccessPointIds: ids });
  }

  async replacePreferenceStep(personId: EntityId, index: number, accessPointId: EntityId): Promise<void> {
    const preference = await this.ensurePreference(personId);
    const ids = [...preference.viaAccessPointIds];
    if (index < 0 || index >= ids.length) return;
    ids[index] = accessPointId;
    await this.commute.saveRoutePreference({ ...preference, viaAccessPointIds: ids });
  }

  private async requireSavedRoute(personId: EntityId, routeId: EntityId): Promise<SavedCommuteRoute> {
    const route = (await this.commute.listSavedRoutes(personId)).find((candidate) => candidate.id === routeId);
    if (!route) throw new Error('Saved commute route was not found.');
    return route;
  }

  private async ensurePreference(personId: EntityId): Promise<RoutePreference> {
    return (await this.commute.getRoutePreference(personId)) ?? {
      id: crypto.randomUUID(),
      personId,
      originPlaceKind: 'origin',
      destinationPlaceKind: 'destination',
      viaAccessPointIds: [],
    };
  }
}

export class TransitSearchService implements TransitSearchActions {
  private readonly resultCache = new Map<string, TransitSearchResult[]>();

  constructor(
    private readonly places: PlaceRepository,
    private readonly commute: CommuteRepository,
    private readonly provider: TransitAccessSearchProvider,
  ) {}

  async search(personId: EntityId, kind: PlaceKind, query: string) {
    const place = await this.places.get(personId, kind);
    if (!place?.coordinate || query.trim().length < 1) return [];
    const results = await this.provider.search(query.trim(), place.coordinate);
    this.resultCache.set(this.key(personId, kind), results);
    return results;
  }

  async nearby(personId: EntityId, kind: PlaceKind) {
    const place = await this.places.get(personId, kind);
    if (!place?.coordinate) return [];
    const results = await this.provider.nearby(place.coordinate);
    this.resultCache.set(this.key(personId, kind), results);
    return results;
  }

  async addAccessPoint(personId: EntityId, kind: PlaceKind, resultId: string): Promise<TransitAccessPoint> {
    const result = this.resultCache.get(this.key(personId, kind))?.find((item) => item.id === resultId);
    if (!result) throw new Error('Transit search result was not found.');
    const point: TransitAccessPoint = {
      id: crypto.randomUUID(),
      personId,
      providerId: result.providerId,
      placeKind: kind,
      mode: result.mode,
      name: result.name,
      displayCode: result.displayCode,
      line: result.line,
      walkMinutes: result.walkMinutes,
      selected: true,
      busRoutes: result.busRoutes,
      selectedBusRouteId: result.busRoutes?.[0]?.providerRouteId,
    };
    await this.commute.upsertAccessPoint(point);
    return point;
  }

  private key(personId: EntityId, kind: PlaceKind) {
    return personId + ':' + kind;
  }
}

function normalizeStopName(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/정류장|정류소/g, '')
    .replace(/\s+/g, '');
}

export class BusRouteService implements BusRouteActions {
  constructor(
    private readonly commute: CommuteRepository,
    private readonly places: PlaceRepository,
    private readonly routeProvider?: TransitRouteProvider | null,
  ) {}

  async listRoutes(personId: EntityId, kind: PlaceKind, accessPointId: EntityId): Promise<BusRouteOption[]> {
    const point = (await this.commute.listAccessPoints(personId, kind))
      .find((candidate) => candidate.id === accessPointId);
    if (!point || point.mode !== 'BUS') return [];
    if (!this.routeProvider) return point.busRoutes ?? [];

    const [origin, destination] = await Promise.all([
      this.places.get(personId, 'origin'),
      this.places.get(personId, 'destination'),
    ]);
    if (!origin?.coordinate || !destination?.coordinate) return point.busRoutes ?? [];

    const routes = await this.routeProvider.search(origin.coordinate, destination.coordinate);
    const target = normalizeStopName(point.name);
    const options = routes.flatMap((route) =>
      (route.busLegs ?? []).flatMap((leg) => {
        const matches = leg.stopNames.some((stop) => {
          const normalized = normalizeStopName(stop);
          return normalized === target || normalized.includes(target) || target.includes(normalized);
        });
        return matches ? leg.routes : [];
      }),
    );

    const unique = new Map<string, BusRouteOption>();
    for (const option of [...options, ...(point.busRoutes ?? [])]) {
      if (!unique.has(option.providerRouteId)) unique.set(option.providerRouteId, option);
    }
    return [...unique.values()];
  }

  setAlias(accessPointId: EntityId, userLabel: string) {
    return this.commute.setAccessPointAlias(accessPointId, userLabel.trim());
  }

  async selectRoute(accessPointId: EntityId, providerRouteId: string) {
    await this.commute.setSelectedBusRoute(accessPointId, providerRouteId);
    await this.commute.setAccessPointSelected(accessPointId, true);
  }
}
