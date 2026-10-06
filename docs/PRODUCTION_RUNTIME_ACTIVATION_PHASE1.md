# Production Runtime Activation — Phase 1

Status: BRANCH-ONLY / NOT MERGED TO PRODUCTION

Branch: activation/runtime-phase1

This phase wires the already-verified notification dependencies into the Worker scheduled entry while preserving fail-closed activation.

The scheduled entry now:

1. creates the provider runtime from Worker environment bindings;
2. evaluates notification activation readiness;
3. passes dependencies to the composite notification cycle only when readiness is complete.

Safety remains layered:

- PUSH_DELIVERY_ENABLED != 1 => scheduler returns disabled before planning or delivery;
- PROVIDER_RUNTIME_ENABLED != 1 => provider runtime is null and readiness has no dependencies;
- missing/invalid VAPID, TTL, retry, Kakao or provider runtime => readiness.dependencies is null;
- no Cron trigger exists from this source change alone;
- no remote D1 migration is applied by this source change;
- no secret values are committed.

Because Cloudflare production currently auto-deploys main, this work remains on a non-main activation branch until CI and remote Cloudflare topology checks pass.
