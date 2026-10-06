# Notification Activation Preflight

Status: NON-LIVE / diagnostic only

This preflight exists to answer one question before any production activation work:
**which requirements are still missing, without exposing secret values or mutating remote resources?**

It does not wire the scheduled Worker, change Cloudflare configuration, apply remote D1 migrations, create Cron triggers, provision secrets, or deploy.

## Config requirements

The preflight checks the existing notification readiness contract:

- VAPID subject
- VAPID public key
- VAPID private key
- Web Push TTL
- notification retry delays
- provider runtime availability
- Kakao REST API key

Presence-event operation also requires a presence-event ingest token.

Only presence/absence and validation state are reported. Secret values are never returned.

## Operational gates

Even with every value present, activation remains BLOCKED until all of these are explicitly completed:

- PUSH_DELIVERY_ENABLED
- PROVIDER_RUNTIME_ENABLED
- live scheduler wiring
- remote D1 migrations
- Cloudflare Cron configuration
- same-origin Worker/static deployment configuration

The pure preflight accepts these operational states as explicit booleans so tests and future activation tooling can evaluate them without performing the operations.

## Current project boundary

Current production Worker entry remains intentionally unwired. Therefore the current project is expected to report BLOCKED for live scheduler wiring until an explicit activation work order authorizes that change.
