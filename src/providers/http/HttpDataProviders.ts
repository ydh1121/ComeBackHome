import type {
  Arrival,
  PlaceSearchProvider,
  PlaceSearchResult,
  RealtimeBusProvider,
  RealtimeSubwayProvider,
  TransitAccessSearchProvider,
  TransitRouteProvider,
  TransitRouteResult,
  TransitSearchResult,
} from '../../application/contracts/providers';
import type { Coordinate } from '../../domain/models';
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

  async arrivals(stationName: string, line?: string): Promise<Arrival[]> {
    const params = new URLSearchParams({ stationName });
    if (line) params.set('line', line);
    return (await this.client.get<{ arrivals: Arrival[] }>(
      '/providers/subway-arrivals?' + params.toString(),
    )).arrivals;
  }
}
