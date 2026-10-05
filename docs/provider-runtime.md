# ComeBackHome Provider Runtime — Phase 5H

Status: BOUNDARY READY / REAL PROVIDERS NOT ACTIVATED

Phase 5H establishes the application and Worker boundary required for future real place/transit provider adapters without introducing provider keys or external provider calls.

## Client runtime

- default provider mode = mock
- explicit provider API mode = `VITE_CBH_PROVIDER_RUNTIME=api`
- provider API mode requires `VITE_CBH_RUNTIME=api`
- unsupported provider runtime values fail startup
- provider HTTP adapters use only same-origin `/api/providers/*`
- no provider base URL is configurable in client code

## Worker runtime

- `PROVIDER_RUNTIME_ENABLED=0` keeps provider runtime disabled
- `/api/providers/status` exposes only activation status
- place/transit provider endpoints fail closed while disabled
- even when the gate is enabled, Phase 5H returns an explicit not-configured response until a real server-side adapter is implemented
- no external provider request is performed in Phase 5H
- no provider key is present in client or repository source

## Activation boundary

A later Work Order must select actual provider(s), define server-side secret bindings, map provider payloads into the existing normalized application contracts, and add provider-specific freshness/rate-limit/error handling.

Phase 5H does not authorize provider keys, live external API requests, remote Cloudflare resources, or deployment.
