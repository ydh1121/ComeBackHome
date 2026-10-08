import type {
  Arrival,
  BusRouteLookupProvider,
  PlaceSearchProvider,
  PlaceSearchResult,
  RealtimeBusProvider,
  RealtimeSubwayProvider,
  TransitAccessSearchProvider,
  TransitRouteProvider,
  TransitRouteResult,
  TransitSearchResult,
} from '../../application/contracts/providers';
import type { BusRouteOption, Coordinate } from '../../domain/models';
import { HttpJsonClient } from './HttpJsonClient';

export class HttpPlaceSearchProvider implements PlaceSearchProvider {
  constructor(private readonly client: HttpJsonClient) {}

  async search(query: string): Promise<PlaceSearchResult[]> {
    const params = new URLSearchParams({ q: query });
    return (await this.client.get<{ results: PlaceSearchResult[] }>(
      '/providers/place-search?' + params.toString(),
    )).results;
  }
}

export class HttpTransitAccessSearchProvider implements TransitAccessSearchProvider {
  constructor(private readonly client: HttpJsonClient) {}

  async search(query: string, near: Coordinate): Promise<TransitSearchResult[]> {
    const params = new URLSearchParams({
      q: query,
      x: String(near.x),
      y: String(near.y),
    });
    return (await this.client.get<{ results: TransitSearchResult[] }>(
      '/providers/transit-search?' + params.toString(),
    )).results;
  }

  async nearby(near: Coordinate): Promise<TransitSearchResult[]> {
    const params = new URLSearchParams({
      x: String(near.x),
      y: String(near.y),
    });
    return (await this.client.get<{ results: TransitSearchResult[] }>(
      '/providers/transit-nearby?' + params.toString(),
    )).results;
  }

  async resolve(result: TransitSearchResult, near: Coordinate): Promise<TransitSearchResult> {
    // Nearby official Seoul bus records already contain the canonical station
    // identity and coordinates. Re-resolving by a shared name may pick a
    // different direction/stop and silently corrupt selected access IDs.
    if (result.mode === 'BUS' && result.id.startsWith('seoul-bus:') &&
        result.providerId && result.coordinate) return result;
    const params = new URLSearchParams({
      mode: result.mode,
      name: result.name,
      x: String(near.x),
      y: String(near.y),
    });
    if (result.line) params.set('line', result.line);
    const response = await this.client.get<{ resolved: Partial<TransitSearchResult> }>(
      '/providers/transit-resolve?' + params.toString(),
    );
    return { ...result, ...response.resolved };
  }
}

export class HttpTransitRouteProvider implements TransitRouteProvider {
  constructor(private readonly client: HttpJsonClient) {}

  async search(origin: Coordinate, destination: Coordinate): Promise<TransitRouteResult[]> {
    const params = new URLSearchParams({
      originX: String(origin.x),
      originY: String(origin.y),
      destinationX: String(destination.x),
      destinationY: String(destination.y),
    });
    return (await this.client.get<{ results: TransitRouteResult[] }>(
      '/providers/routes?' + params.toString(),
    )).results;
  }
}

export class HttpBusRouteLookupProvider implements BusRouteLookupProvider {
  constructor(private readonly client: HttpJsonClient) {}

  async listByStop(arsId: string): Promise<BusRouteOption[]> {
    const params = new URLSearchParams({ arsId });
    return (await this.client.get<{ routes: BusRouteOption[] }>(
      '/providers/bus-routes?' + params.toString(),
    )).routes;
  }
}

export class HttpRealtimeBusProvider implements RealtimeBusProvider {
  constructor(private readonly client: HttpJsonClient) {}

  async arrivals(stopProviderId: string, routeProviderId: string): Promise<Arrival[]> {
    const params = new URLSearchParams({ stopProviderId, routeProviderId });
    return (await this.client.get<{ arrivals: Arrival[] }>(
      '/providers/bus-arrivals?' + params.toString(),
    )).arrivals;
  }
}

export class HttpRealtimeSubwayProvider implements RealtimeSubwayProvider {
  constructor(private readonly client: HttpJsonClient) {}

  async arrivals(providerStationId: string, stationName: string, line?: string): Promise<Arrival[]> {
    const params = new URLSearchParams({ providerStationId, stationName });
    if (line) params.set('line', line);
    return (await this.client.get<{ arrivals: Arrival[] }>(
      '/providers/subway-arrivals?' + params.toString(),
    )).arrivals;
  }
}
