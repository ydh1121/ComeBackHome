# Cloudflare Environment Contract

Status: NON-LIVE / configuration contract

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

Safe pre-activation values:

- VITE_CBH_RUNTIME=mock
- VITE_CBH_PROVIDER_RUNTIME=mock

Production API/provider activation values, only after Worker + D1 + provider readiness is complete:

- VITE_CBH_RUNTIME=api
- VITE_CBH_PROVIDER_RUNTIME=api

VITE_CBH_VAPID_PUBLIC_KEY is a Vite build-time public value.

For the current Cloudflare project UI it may be entered on the same Variables and secrets screen as a Text variable, provided it is available to the build environment used for the production deployment.

Its value must be exactly the same public key as VAPID_PUBLIC_KEY.

## Safe staged state

Before explicit live activation approval:

- PROVIDER_RUNTIME_ENABLED=0
- PUSH_DELIVERY_ENABLED=0
- VITE_CBH_RUNTIME=mock
- VITE_CBH_PROVIDER_RUNTIME=mock

All other values may be prepared in advance without enabling provider calls or Web Push delivery.

## Live activation boundary

Changing either enable flag to 1 is not sufficient by itself and is not authorized by this contract.

Live activation additionally requires:

- production D1 binding and migrations
- scheduled Worker dependency wiring
- Cloudflare Cron configuration
- same-origin Worker/static deployment
- explicit production activation approval

## Secret handling

Never commit production secret values to Git.

The repository ignores .env and .env.* while explicitly allowing the placeholder-only .env.example file.
