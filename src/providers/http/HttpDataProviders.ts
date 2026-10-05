import type {
  PlaceSearchProvider,
  PlaceSearchResult,
  TransitAccessSearchProvider,
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
}
