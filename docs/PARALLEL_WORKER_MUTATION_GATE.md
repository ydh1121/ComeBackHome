# Parallel Worker Mutation Gate

Status: ACCESS-PROTECTED MUTATIONS ENABLED

The parallel Worker is protected by Cloudflare Access before Worker/API execution.

Current runtime setting:

- MUTATIONS_ENABLED=1

This enables authenticated product writes on the parallel Worker only because the Access perimeter has been created and independently verified to intercept anonymous requests.

Defense in depth remains available in code: when MUTATIONS_ENABLED=0, all non-GET/HEAD/OPTIONS API requests return HTTP 503 before touching D1.

Protection evidence required before MUTATIONS_ENABLED=1:

- Access application: ComeBackHome Runtime
- exact domain: come-back-home-runtime.ydh1121.workers.dev
- self_hosted type
- exactly one allow policy
- exactly one email include selector
- no identity value committed to source/evidence

Provider runtime and push delivery remain disabled, no Cron is configured, and existing Pages production remains unchanged.
