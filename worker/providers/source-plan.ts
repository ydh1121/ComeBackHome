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
  secrets: 'worker-only',
  clientKeysAllowed: false,
  externalRequestsAllowedInPhase5I: false,
  remoteActivationAllowedInPhase5I: false,
  fabricatedRealtimeAllowed: false,
} as const;
