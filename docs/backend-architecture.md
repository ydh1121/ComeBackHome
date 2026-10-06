# ComeBackHome Backend Architecture

Status: CANONICAL / PAGES + MINIMAL PRIVATE SCHEDULER

## Canonical application runtime

- Sole user-facing origin: `https://come-back-home.pages.dev/`
- Canonical Cloudflare Pages project: `come-back-home`
- Frontend: Cloudflare Pages
- Backend API: Pages Functions under same-origin `/api/*`
- Database: Cloudflare D1 `come-back-home-db`, direct Pages binding `DB`
- Provider calls: executed directly by Pages Functions
- Web Push signing and delivery: executed directly by Pages Functions
- Presence event handling: Pages Functions
- Notification planner/outbox business logic: Pages Functions
- Production preview deployments: disabled
- Service Binding to the old application backend: none

The browser uses only the canonical Pages origin.

## Minimal private scheduler

Cloudflare Pages Functions do not expose the Cron `scheduled()` execution surface required for scheduled shift-end and periodic ETA-change detection.

The existing `come-back-home-runtime` Worker is retained only as a private scheduler trigger:

```text
Cloudflare Cron
  -> come-back-home-runtime scheduled()
  -> authenticated POST https://come-back-home.pages.dev/api/internal/scheduler-tick
  -> Pages Functions
  -> D1 + notification planner + Kakao ETA + Web Push
```

The Worker does not serve the SPA, expose the normal application API, bind D1, execute Kakao application logic, or become a user-facing URL. `workers_dev=false` and `preview_urls=false` remain mandatory.

## Scheduler authentication

`/api/internal/scheduler-tick` is server-only and uses the existing server-to-server bearer authentication contract. The value is never sent to browser code or emitted in logs.

The scheduler invokes the existing planner/outbox path. Existing notification dedupe keys and D1 outbox semantics remain authoritative, so repeated Cron ticks do not duplicate the same planned notification.

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

Scheduled notifications:
- scheduled shift-end
- periodic ETA-change detection

Event-driven notifications:
- `LEFT_WORK`
- `ARRIVED_HOME`

Both paths use Pages-owned application logic and the same D1 notification contracts.

## Secrets and bindings

Pages Production owns:
- `DB`
- `KAKAO_REST_API_KEY`
- `VAPID_PRIVATE_KEY`
- `PRESENCE_EVENT_INGEST_TOKEN`
- public VAPID/runtime configuration

Scheduler Worker owns only:
- `PAGES_ORIGIN=https://come-back-home.pages.dev`
- the server-to-server invocation secret already present on the existing Worker
- the one-minute Cron trigger

No client bundle receives server-only secret values.

## Deployment authority

GitHub `main` is the only canonical source branch after migration cleanup.
Cloudflare Pages project `come-back-home` is the only application deployment target.
The retained `come-back-home-runtime` resource is private scheduler infrastructure only, not a canonical product or application backend.
No additional Worker, Pages, staging, preview or fallback project is allowed without a new explicit user decision.
