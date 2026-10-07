# ComeBackHome Provider Request Clients — Phase 5K

Status: FIXTURE-TRANSPORT READY / NETWORK TRANSPORT NOT IMPLEMENTED

Phase 5K connects the selected source contracts to documented provider request shapes without adding a network implementation.

## Transport boundary

Provider request clients emit ProviderJsonRequest objects into an injected ProviderJsonTransport. The request object contains:

- source and capability
- GET method
- documented URL template
- plain query/path parameters
- an opaque secret reference describing where a Worker secret must later be injected
- transport-security status

It does not contain a secret value and does not call fetch.

## Kakao

Kakao request plans use HTTPS and an Authorization header secret reference:

- place keyword search: /v2/local/search/keyword.json
- public transit routing: /v2/routing/publictraffic
- secret reference: KAKAO_REST_API_KEY
- authorization prefix: KakaoAK
- input/output coordinates: WGS84

## Seoul bus

The Seoul catalog currently documents http://ws.bus.go.kr examples. Phase 5K records that endpoint shape but marks every Seoul bus request DOCUMENTED_HTTP_REQUIRES_VALIDATION.

This is an activation blocker: a future real network transport must not send a service key over cleartext HTTP. HTTPS capability or another secure server-side path must be verified before activation.

Request plans:
- stop name search: /api/rest/stationinfo/getStationByName with stSrch
- route-wide arrivals: /api/rest/arrive/getArrInfoByRouteAll with busRouteId
- secret reference: SEOUL_BUS_SERVICE_KEY as serviceKey query injection

The route-wide response is filtered by both busRouteId and stop stId after receipt. This avoids requiring a stop ordinal in the application RealtimeBusProvider contract.

## Seoul subway

Current Seoul Open Data documentation also publishes HTTP sample URLs. Phase 5K records the documented templates and marks them DOCUMENTED_HTTP_REQUIRES_VALIDATION.

Request plans:
- station-name canonicalization: `SearchInfoBySubwayNameService` using `SEOUL_OPENAPI_KEY` (general Seoul Open Data key)
- realtime station arrivals: `realtimeStationArrival` using `SEOUL_SUBWAY_API_KEY` (dedicated realtime-subway key)
- realtime train positions: `realtimePosition` using `SEOUL_SUBWAY_API_KEY`
- the two Seoul subway key classes are intentionally non-interchangeable and are injected independently

The realtime arrival endpoint requires statnNm. RealtimeSubwayProvider was corrected to accept canonical stationName rather than a station ID.

## Fake-transport verification

Dependency tests inject a fake ProviderJsonTransport that:
1. records the request plan,
2. returns the Phase 5J fixture assigned to that capability,
3. verifies the source client returns the same normalized mapper output,
4. asserts auth references and security classification without resolving any credential.

## Safety boundary

- no network transport
- no fetch
- no secret values
- no provider activation
- Seoul documented HTTP endpoints are explicitly blocked from live use until secure transport is proven
- no remote Cloudflare resources or deploy
