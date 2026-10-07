# Cloudflare Environment Contract

Status: PRODUCTION-CAPABLE / secret-value-free configuration contract

This document defines exactly where each ComeBackHome production value belongs.
It does not provision values, change Cloudflare resources, enable providers, enable push delivery, run D1 migrations, create Cron triggers, or deploy.

## Cloudflare project

Target surface:

- Cloudflare Dashboard
- Workers & Pages
- ComeBackHome
- Settings
- Production
- Variables and secrets

In the current Pages/Workers project UI, Text and Secret variables are managed from the same Variables and secrets screen.

## Runtime values

### Secret

These values must be stored as Cloudflare Secret:

- KAKAO_REST_API_KEY
- SEOUL_BUS_SERVICE_KEY
- SEOUL_SUBWAY_API_KEY
- VAPID_PRIVATE_KEY
- PRESENCE_EVENT_INGEST_TOKEN

### Text

These values are non-secret runtime configuration:

- VAPID_PUBLIC_KEY
- VAPID_SUBJECT
- WEB_PUSH_TTL_SECONDS
- NOTIFICATION_RETRY_DELAYS_SECONDS
- PROVIDER_RUNTIME_ENABLED
- PUSH_DELIVERY_ENABLED

The public VAPID key is intentionally not secret.

## Build-time values

VITE_CBH_RUNTIME and VITE_CBH_PROVIDER_RUNTIME control which client runtime is compiled into the production bundle.

Safe local-development values:

- VITE_CBH_RUNTIME=mock
- VITE_CBH_PROVIDER_RUNTIME=mock

Canonical production API/provider values:

- VITE_CBH_RUNTIME=api
- VITE_CBH_PROVIDER_RUNTIME=api

VITE_CBH_VAPID_PUBLIC_KEY is a Vite build-time public value.

For the current Cloudflare project UI it may be entered on the same Variables and secrets screen as a Text variable, provided it is available to the build environment used for the production deployment.

Its value must be exactly the same public key as VAPID_PUBLIC_KEY.

## Safe local state

For local development without external calls:

- PROVIDER_RUNTIME_ENABLED=0
- PUSH_DELIVERY_ENABLED=0
- VITE_CBH_RUNTIME=mock
- VITE_CBH_PROVIDER_RUNTIME=mock

All other values may be prepared in advance without enabling provider calls or Web Push delivery.

## Production runtime boundary

Canonical production requires:

- production D1 binding and migrations
- direct Pages Functions API/provider runtime
- minimal private scheduler Worker for clock-driven rules
- Cloudflare Cron on that scheduler
- same-origin Pages deployment
- provider secrets kept server-side

Kakao provides route/place data. Seoul bus/subway secrets are optional capability bindings: when absent or out of coverage, realtime data must degrade to FALLBACK rather than fabricate a LIVE value.

## Secret handling

Never commit production secret values to Git.

The repository ignores .env and .env.* while explicitly allowing the placeholder-only .env.example file.
