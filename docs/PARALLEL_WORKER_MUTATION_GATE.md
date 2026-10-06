# Parallel Worker Mutation Gate

Status: ACTIVE ON PARALLEL WORKER

The parallel Worker is publicly reachable on workers.dev while Cloudflare Access is not yet configured.

To prevent anonymous writes to the new D1 database during migration, the Worker uses:

- MUTATIONS_ENABLED=0

When this value is 0, all non-GET/HEAD/OPTIONS API requests return HTTP 503 before touching D1. Read-only health/bootstrap/provider-status routes remain available for migration verification.

The gate covers people, schedules, places, commute preferences, notification settings, push subscriptions and trusted presence-event POSTs.

Do not change MUTATIONS_ENABLED to 1 until the private access perimeter is verified.
