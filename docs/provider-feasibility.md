# ComeBackHome Provider Feasibility — Phase 5I

Status: SOURCE SELECTION COMPLETE / LIVE ACTIVATION NOT AUTHORIZED

## Selected v1 source stack

| Product capability | Primary source | Coverage | Phase 5I decision |
| --- | --- | --- | --- |
| Place/address search | Kakao Map REST API | Korea | SELECTED |
| Public-transit route candidates | Kakao Map REST API public-transit routing | Korea | SELECTED |
| Bus stop access search | Seoul bus stop information API | Seoul | SELECTED |
| Realtime bus arrivals | Seoul bus arrival information API | Seoul | SELECTED |
| Subway station access search | Seoul subway station data/search, with Kakao place fallback | Seoul-first | SELECTED |
| Realtime subway arrivals | Seoul realtime subway arrival API | Seoul-provided sections | SELECTED |
| Realtime subway train positions | Seoul realtime train position API | supported metropolitan lines | SELECTED |

## Why this split

Kakao Map now exposes both keyword place search and public-transit route retrieval behind the REST API key. This removes the need for a second commercial route-planning provider for v1.

Seoul public transit sources remain necessary for realtime arrival/position data. The Seoul bus group exposes stop lookup, arrival and vehicle position data. The subway realtime arrival API explicitly warns that some non-Seoul station sections are not provided and that response generation time can lag current time, so the application must use the provider timestamp when judging freshness.

## Auth and quota model

Kakao credentials are server-side Worker secrets only. Never expose the REST API key through Vite environment variables or browser code.

Kakao published free daily quotas currently include:
- keyword place search: 100,000 requests/day
- public-transit route retrieval: 1,000 requests/day

Seoul realtime subway uses its own subway API key. The Seoul Open Data FAQ states the normal subway key is limited to 1,000 calls/day; a registered utilization case can be reviewed for removal of that daily limit.

Seoul bus stop/arrival APIs are linked through the public-data portal and require that service's issued key. The retrieved Seoul catalog page did not state a fixed quota, so Phase 5I does not invent one.

## Normalization rules

### Kakao place search -> PlaceSearchResult
- providerId <- Kakao place id
- placeName <- place_name
- roadAddress <- road_address_name, falling back to address_name when necessary
- lotAddress <- address_name when distinct
- coordinate.x <- x longitude
- coordinate.y <- y latitude
- category <- category_name

### Kakao public-transit route -> RouteCandidate
- totalMinutes <- totalTime seconds converted to minutes
- transferCount <- transfers
- fare <- fare.value when present
- steps <- normalized from route step guidance and vehicle type/name
- route IDs are adapter-generated stable hashes from source identity + normalized route structure; transient ETA values are not persisted as route identity
- walkMinutes must not be guessed from undocumented semantics; it remains an adapter validation item until a real response fixture proves a deterministic mapping

### Seoul bus -> TransitSearchResult / Arrival
- stop IDs and route IDs remain provider-stable identifiers
- stop canonical name is immutable provider data; userLabel remains separate
- arrival.minutes must come from provider arrival data, never from UI inference
- observedAt uses provider observation time when available; otherwise the server fetch timestamp must be marked as the observation fallback in adapter diagnostics

### Seoul subway -> Arrival / train position
- station name and line are canonicalized before querying realtime endpoints
- observedAt maps from provider receipt/generation time such as recptnDt
- freshness is calculated from observedAt at runtime
- stale/out-of-coverage/error results trigger FALLBACK or UNKNOWN; they never become fabricated LIVE data

## Coverage and fallback

Realtime is Seoul-first. Kakao route planning may return routes beyond Seoul, but Seoul realtime subway documentation states that station sections outside Seoul can be unavailable. Therefore route availability and realtime availability are separate capabilities.

When route planning works but realtime does not:
1. keep the route candidate,
2. mark realtime as FALLBACK or UNKNOWN,
3. preserve source/freshness diagnostics,
4. do not claim a live ETA.

Exact LIVE/STALE duration thresholds are intentionally deferred until authenticated sample fixtures are available. Phase 5I defines the timestamp contract but does not invent an SLA.

## Server secret bindings

Future Worker-only bindings:
- KAKAO_REST_API_KEY
- SEOUL_SUBWAY_API_KEY
- SEOUL_BUS_SERVICE_KEY

No values are committed. No VITE_* provider key is allowed.

## Official references

- Kakao Map REST API: https://developers.kakao.com/docs/en/kakaomap/rest-api
- Kakao quota: https://developers.kakao.com/docs/ko/getting-started/quota
- Seoul bus data group: https://data.seoul.go.kr/dataList/19/literacyView.do
- Seoul bus stop information: https://data.seoul.go.kr/dataList/OA-1094/L/1/datasetView.do
- Seoul bus arrival information: https://data.seoul.go.kr/dataList/OA-1091/L/1/datasetView.do
- Seoul realtime subway arrival: https://data.seoul.go.kr/dataList/OA-12764/A/1/datasetView.do
- Seoul realtime train position: https://data.seoul.go.kr/dataList/OA-12601/A/1/datasetView.do
- Seoul subway station-name search: https://data.seoul.go.kr/dataList/OA-121/A/1/datasetView.do

## Phase 5I safety boundary

This phase does not add provider key values, execute live provider calls, create remote resources, enable PROVIDER_RUNTIME_ENABLED, or deploy Cloudflare. The next implementation unit may create source-specific server adapters against recorded fixtures/contracts before any live activation.
