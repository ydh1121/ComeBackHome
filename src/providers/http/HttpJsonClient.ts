import { JsonHttpClient } from '../../../packages/portable/http/json-client';
import { cachedRead, invalidateLocalReads } from '../../pwa/localCache';
export { HttpApiError } from '../../../packages/portable/http/json-client';

export class HttpJsonClient extends JsonHttpClient {
  constructor(basePath = '/api', onMutation: () => void = () => undefined) {
    super(basePath, onMutation, { read: cachedRead, invalidate: invalidateLocalReads });
  }
}
