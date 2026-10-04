# ComeBackHome Backend Architecture — Phase 5D

Status: DECIDED / NOT DEPLOYED

## Selected stack

- Cloudflare Worker: one deployable application named `come-back-home`
- Workers Static Assets: React/Vite SPA hosting
- Worker fetch handler: same-origin `/api/*`
- Cloudflare D1: relational persistence
- D1 planned name: `come-back-home-db`
- D1 binding: `DB`
- D1 location hint when created later: `apac`
- Cron Trigger: `* * * * *` (every minute, UTC scheduler)
- Product timezone: `Asia/Seoul`
- Cloudflare Access: private perimeter protection when deployment is authorized
- Workers Builds: GitHub-connected CI/CD when deployment is authorized

## Why one Worker instead of Pages + a second Worker

The project is still pre-deployment. A single Worker can serve the React SPA as static assets, handle same-origin API routes, bind D1, and own the scheduled handler. This avoids a Pages Functions API plus a separate scheduler Worker and removes cross-service routing/CORS complexity.

The existing product route manifest remains client-side React Router authority. Worker routing is limited to server API paths and scheduled execution.

## Persistence scope

Persist:
- people
- origin/destination places
- schedules
- selected transit access points
- manual commute preference ordering
- notification settings
- Web Push subscriptions
- notification jobs/outbox

Do not persist initially:
- realtime bus/subway arrival values
- transient route candidates
- computed ETA snapshots
- search results
- import preview files/batches after commit

Those runtime values remain provider-derived and replaceable.

## Notification scheduling

Use a D1 outbox table rather than a Queue in v1.

A one-minute Cron Trigger:
1. selects jobs whose `status` is pending/retry and whose `next_attempt_at` is due;
2. claims a bounded batch;
3. sends a visible Web Push notification to active subscriptions;
4. marks success as sent;
5. records bounded retry state for transient failures;
6. deactivates invalid subscriptions when the future delivery adapter reports a terminal subscription failure.

Every logical notification uses a unique `dedupe_key` so repeated cron execution cannot create duplicate jobs.

All persisted timestamps are UTC ISO strings. Schedule dates/times are interpreted in `Asia/Seoul`.

## Why no Queue yet

Cloudflare Queues are useful for guaranteed asynchronous delivery and retries, but this app has personal-use traffic and one-minute polling. A D1 outbox with idempotent jobs is simpler and sufficient.

Add Queues only if:
- push delivery volume grows materially;
- provider work needs decoupling;
- retry traffic becomes significant;
- cron execution duration becomes operationally noisy.

If Queues are added later, preserve the D1 `dedupe_key` as the idempotency key because queue delivery is at-least-once.

## Why no Durable Objects

There is no current need for:
- websocket sessions;
- strongly serialized per-user mutation streams;
- leader election;
- high-contention counters.

D1 is the appropriate source of truth for this application.

## API boundary

Same-origin API namespace: `/api/*`.

Planned contract groups:
- `/api/bootstrap`
- `/api/people`
- `/api/schedules`
- `/api/places`
- `/api/commute`
- `/api/notifications/settings`
- `/api/push/subscription`

The exact REST shapes are deferred to the implementation phase. The Worker must translate HTTP payloads into existing application/domain models rather than exposing D1 row shapes directly.

## Security boundary

When deployment is authorized:
- protect `come-back-home` with Cloudflare Access as a private application;
- allow only explicitly approved user email identities;
- keep push signing private material in Worker secrets, never client code or D1;
- expose only the public push configuration to the browser;
- keep D1 reachable only through bindings.

No authentication table is required for the initial personal-use version while Access remains the perimeter identity layer.

## Deployment guard

Phase 5D does not:
- create a D1 database;
- apply migrations;
- create a Worker;
- configure Cron;
- configure Access;
- set push keys;
- activate browser push;
- deploy to Cloudflare.

Those operations require a later explicit deployment/activation phase.
