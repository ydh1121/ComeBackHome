# Pages to Workers Migration — Activation Phase 1

Status: PARALLEL WORKER PREPARATION / PAGES REMAINS PRODUCTION

Current production:
- Cloudflare Pages project: come-back-home
- Git source: ydh1121/ComeBackHome main
- public origin: https://come-back-home.pages.dev/
- current client runtime: mock

Target runtime:
- Cloudflare Worker staging name: come-back-home-runtime
- Worker entry: worker/index.ts
- Static Assets: dist
- API routes: /api and /api/*
- D1, Cron, provider and push activation are added only after remote resource identities are verified.

Migration sequence:

1. Keep existing Pages production online.
2. Connect activation/runtime-phase1 or the repository to Workers Builds as a separate Worker.
3. Deploy Worker Static Assets with runtime/provider/push disabled.
4. Verify Worker preview/static site parity.
5. Create or identify production D1 and bind it as DB.
6. Apply migrations.
7. Configure Worker secrets/runtime values.
8. Set VITE_CBH_RUNTIME=api and VITE_CBH_PROVIDER_RUNTIME=api for the Worker build only after API/D1/provider readiness passes.
9. Add Cron only after scheduler readiness passes.
10. Cut production traffic to Worker.
11. Disable Pages automatic deployments after Worker production is verified.

No D1 database ID is invented in source. No Cron trigger is declared yet.
