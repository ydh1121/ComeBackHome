# ComeBackHome Provider Feasibility

Status: PRODUCT PATH ACTIVE / SERVER-SECRET-GATED

## Selected source stack

| Capability | Primary source | Coverage |
| --- | --- | --- |
| Place/address search | Kakao Map REST API | Korea |
| Public-transit routes | Kakao public-transit routing | Korea |
| Bus stop resolution | Seoul bus stop information API | Seoul |
| Bus routes by stop | Seoul bus route-by-station API | Seoul |
| Realtime bus arrivals | Seoul bus arrival API | Seoul |
| Subway station resolution | Seoul subway station search API | Seoul-first |
| Realtime subway arrivals | Seoul realtime subway arrival API | supported metropolitan sections |

## Runtime policy

- Browser code never receives provider secrets.
- Kakao remains HTTPS-only.
- Seoul official HTTP endpoints are allowed only through the server-side official-host allowlist.
- Missing/failed realtime data degrades to FALLBACK or UNKNOWN.
- Fabricated realtime data is forbidden.
- Route planning and realtime availability are independent.
- Final product promotion requires `KAKAO_REST_API_KEY`, `SEOUL_BUS_SERVICE_KEY`, `SEOUL_OPENAPI_KEY`, and `SEOUL_SUBWAY_API_KEY`.
- `SEOUL_OPENAPI_KEY` is the general Seoul Open Data key for station-name/code lookup.
- `SEOUL_SUBWAY_API_KEY` is the separately issued realtime-subway key; it is not treated as interchangeable with the general key.

## ETA policy

Kakao route results provide total route time plus normalized access/egress walking time.
When a selected saved-route access point has usable realtime arrival data, the runtime overlays the next reachable vehicle wait onto the route core time.
Provider observations older than the stale threshold are ignored.
Without usable realtime data, the route-based ETA remains available as FALLBACK.

## Local/runtime boundary

Local Wrangler keeps PROVIDER_RUNTIME_ENABLED disabled by default so tests do not call external services.
Production Pages runtime enables provider mode and binds secrets server-side.
Fixture-backed and in-process provider E2E tests verify the complete application -> Pages API -> provider source contract without exposing credentials.

## Official references

- Kakao Map REST API
- Seoul bus stop / route / arrival Open APIs
- Seoul realtime subway arrival Open API
