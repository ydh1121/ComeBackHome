# ComeBackHome Provider Runtime

Status: PRODUCT API RUNTIME ACTIVE / DEV MOCK ISOLATED

## Client runtime

- production default provider mode = api
- production persistence runtime = api
- mock runtime is development-only and loaded from `src/app/mockComposition.ts`
- provider-disabled API mode uses empty/fail-closed provider boundaries, never fixture data
- provider HTTP adapters use only same-origin `/api/providers/*`
- normalized client boundaries cover place search, transit access, route candidates, bus routes, realtime bus arrivals and realtime subway arrivals
- no external provider base URL or secret is exposed to browser code

## Pages runtime

- `PROVIDER_RUNTIME_ENABLED=1` activates the server provider runtime in canonical production
- local Wrangler keeps `PROVIDER_RUNTIME_ENABLED=0` to prevent accidental external requests
- `/api/providers/status` exposes capability presence without secret values
- provider requests are implemented by server-only source adapters
- missing/failed realtime data degrades to FALLBACK/UNKNOWN and never to fixture data

## Production boundary

Final promotion requires:
- `KAKAO_REST_API_KEY`
- `SEOUL_BUS_SERVICE_KEY`
- `SEOUL_OPENAPI_KEY`
- `SEOUL_SUBWAY_API_KEY`

Production builds must not contain mock fixture identities or QA routes.
