# ComeBackHome Backend Architecture

Status: CANONICAL / PAGES-ONLY

## Canonical runtime

- User and application origin: `https://come-back-home.pages.dev/`
- Frontend: Cloudflare Pages
- Backend API: Pages Functions under same-origin `/api/*`
- Database: Cloudflare D1 `come-back-home-db`, binding `DB`
- Provider calls: executed directly by Pages Functions
- Web Push signing and delivery: executed directly by Pages Functions
- Production preview deployments: disabled
- Separate application Worker: none
- Service Binding to a backend Worker: none
- Public or private `workers.dev` application endpoint: none

The previous `come-back-home-runtime` Worker was a temporary migration surface and is not part of the canonical architecture.

## Persistence scope

Persist:
- people
- origin/destination places
- schedules
- selected transit access points
- multiple saved commute routes and via transit legs
- notification settings
- Web Push subscriptions
- notification jobs/outbox

Provider-derived search results, live route candidates and map responses remain runtime data.

## Notification model

Core product notifications are event-driven.

`LEFT_WORK` and `ARRIVED_HOME` events are accepted by the same-origin Pages API. The API creates the notification payload, including the next workday information, and immediately processes the Web Push outbox in the same Pages request.

There is no standalone Cron Worker in the canonical architecture. Worker-only periodic shift-end/ETA polling is not used while the product is constrained to one canonical Pages application surface.

## API boundary

Canonical API namespace: `https://come-back-home.pages.dev/api/*`.

Pages Functions translate HTTP requests into the existing application/domain models and access D1 only through the direct `DB` binding.

## Secrets and bindings

Pages Production owns:
- `DB` D1 binding
- `KAKAO_REST_API_KEY`
- `VAPID_PRIVATE_KEY`
- `PRESENCE_EVENT_INGEST_TOKEN`
- public VAPID/runtime configuration

No client bundle receives server-only secret values.

## Deployment authority

GitHub `main` is the only source branch.
Cloudflare Pages project `come-back-home` is the only application deployment target.
No alternate Worker deployment is allowed without an explicit new user decision.
