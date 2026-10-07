import type { ProviderSourceBundle, ProviderSecretBindings } from './contracts';
import type { WorkerEnv } from '../runtime-types';
import { SecureProviderJsonTransport, ObjectProviderSecretResolver, type ProviderFetch } from './network-transport';
import {
  KakaoMapRequestClient,
  SeoulBusRequestClient,
  SeoulSubwayRequestClient,
} from './source-clients';

function secretBindingsFromEnv(env: WorkerEnv): ProviderSecretBindings {
  return {
    ...(env.KAKAO_REST_API_KEY ? { KAKAO_REST_API_KEY: env.KAKAO_REST_API_KEY } : {}),
    ...(env.SEOUL_BUS_SERVICE_KEY ? { SEOUL_BUS_SERVICE_KEY: env.SEOUL_BUS_SERVICE_KEY } : {}),
    ...(env.SEOUL_OPENAPI_KEY ? { SEOUL_OPENAPI_KEY: env.SEOUL_OPENAPI_KEY } : {}),
    ...(env.SEOUL_SUBWAY_API_KEY ? { SEOUL_SUBWAY_API_KEY: env.SEOUL_SUBWAY_API_KEY } : {}),
  };
}

export function createProviderRuntime(
  env: WorkerEnv,
  providerFetch: ProviderFetch,
): ProviderSourceBundle | null {
  if (env.PROVIDER_RUNTIME_ENABLED !== '1') return null;

  const secrets = new ObjectProviderSecretResolver(secretBindingsFromEnv(env));
  const transport = new SecureProviderJsonTransport(providerFetch, secrets);

  return {
    kakao: new KakaoMapRequestClient(transport),
    seoulBus: new SeoulBusRequestClient(transport),
    seoulSubway: new SeoulSubwayRequestClient(transport),
  };
}
