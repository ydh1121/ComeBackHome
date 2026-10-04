# ComeBackHome Local Integration — Phase 5G

Status: LOCAL-ONLY / NOT DEPLOYED

Phase 5G exists to prove the Worker + D1 + hybrid API composition path without creating or mutating any Cloudflare remote resource.

## Local configuration

Use only `wrangler.local.jsonc` for this phase.

The configuration keeps the future deployment name `come-back-home`, binds `DB`, serves `./dist` through the `ASSETS` binding, and routes `/api` and `/api/*` through the Worker first.

The D1 `database_id` is intentionally the all-zero placeholder. It is not a production or preview resource identifier and must not be replaced before a separately authorized deployment phase.

`PUSH_DELIVERY_ENABLED` stays `0`.

## Commands

Static source/config guard:

```bash
npm run verify:local-contract
```

Apply migrations only to Wrangler local state:

```bash
npm run cf:local:migrate
```

Run the Worker in explicit local mode:

```bash
npm run cf:local:dev
```

Run the full Phase 5G local integration harness:

```bash
npm run verify:local-integration
```

The full harness builds the frontend with `VITE_CBH_RUNTIME=api`, creates an isolated temporary Wrangler persistence directory, applies `db/migrations` with `--local`, starts `wrangler dev --local`, exercises Worker API + local D1, loads the actual hybrid application composition through Vite SSR, verifies persisted/runtime state separation, confirms the import safety block, and removes the temporary local state at the end.

## Safety boundary

Phase 5G does not authorize or execute:

- remote D1 creation
- remote migration apply
- `wrangler deploy`
- `--remote`
- Cloudflare Access changes
- Cron deployment
- VAPID/private key configuration
- real push delivery
- real transit provider activation

A successful local integration run proves local readiness only. It is not production deployment approval.
