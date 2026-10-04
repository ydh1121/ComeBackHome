# ComeBackHome Runtime Modes

Status: Phase 5F / pre-deployment

## Default

`VITE_CBH_RUNTIME` unset or `mock`:

- all repositories use in-memory mock state;
- provider data uses mock providers;
- no Worker API is required.

## Hybrid API

`VITE_CBH_RUNTIME=api`:

- people, schedules, places and persisted commute state use same-origin `/api/*`;
- notification rules use the Worker API;
- browser notification permission/subscription state remains client-runtime state;
- Today/ETA, automatic route candidates, search providers and import preview remain mock/runtime-only;
- import commit is deliberately disabled while the import parser is still mock-backed;
- browser push adapter and push-subscription HTTP transport remain inactive.

The API base is not configurable from the client. Requests are same-origin and always use `/api`.

## Activation rule

Do not set `VITE_CBH_RUNTIME=api` for a deployed build until:

1. the Worker is running with the D1 binding;
2. migrations have been applied;
3. local/API integration checks pass;
4. the deployment phase explicitly authorizes remote resources.

Any unsupported runtime mode fails application startup rather than silently falling back.
