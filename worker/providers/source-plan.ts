export const PROVIDER_SOURCE_PLAN = {
  placeSearch: {
    primary: 'kakao-map',
    capability: 'keyword-place-search',
    coverage: 'KOREA',
  },
  transitRoute: {
    primary: 'kakao-map',
    capability: 'public-transit-routing',
    coverage: 'KOREA',
  },
  transitAccess: {
    busPrimary: 'seoul-bus',
    subwayPrimary: 'seoul-subway',
    placeFallback: 'kakao-map',
    coverage: 'SEOUL',
  },
  realtimeBus: {
    primary: 'seoul-bus',
    coverage: 'SEOUL',
  },
  realtimeSubway: {
    primary: 'seoul-subway',
    coverage: 'SEOUL_METRO_PARTIAL',
    freshnessField: 'recptnDt',
  },
} as const;

export const PROVIDER_ACTIVATION_POLICY = {
  secrets: 'server-only',
  requiredProductionSecrets: [
    'KAKAO_REST_API_KEY',
    'SEOUL_BUS_SERVICE_KEY',
    'SEOUL_OPENAPI_KEY',
    'SEOUL_SUBWAY_API_KEY',
  ],
  clientKeysAllowed: false,
  officialSeoulHttpAllowlistRequired: true,
  missingRealtimeSecretBehavior: 'FALLBACK',
  fabricatedRealtimeAllowed: false,
} as const;
