# Runtime Secret Sync

Purpose: move required activation values from GitHub Actions secrets into the protected parallel Cloudflare Worker without printing or committing secret values.

Required GitHub repository secrets:

- KAKAO_REST_API_KEY
- VAPID_PUBLIC_KEY
- VAPID_PRIVATE_KEY
- PRESENCE_EVENT_INGEST_TOKEN

Already-required deployment secrets:

- CLOUDFLARE_API_TOKEN
- CLOUDFLARE_ACCOUNT_ID

The sync workflow writes only these server-only values into Cloudflare Worker secrets:

- KAKAO_REST_API_KEY
- VAPID_PRIVATE_KEY
- PRESENCE_EVENT_INGEST_TOKEN

VAPID_PUBLIC_KEY is intentionally public. After sync it is written to wrangler.jsonc with these non-secret operational values:

- VAPID_SUBJECT=https://come-back-home-runtime.ydh1121.workers.dev/
- WEB_PUSH_TTL_SECONDS=300
- NOTIFICATION_RETRY_DELAYS_SECONDS=30,90,300

The deployment workflow loads VAPID_PUBLIC_KEY from wrangler.jsonc into VITE_CBH_VAPID_PUBLIC_KEY at build time.

The sync workflow is triggered only by manual workflow dispatch or a change to runtime-activation/secret-sync.trigger. Adding a GitHub secret by itself does not run the workflow.

Provider and push enable flags remain separate. Secret synchronization does not set PROVIDER_RUNTIME_ENABLED=1, PUSH_DELIVERY_ENABLED=1, or configure Cron.
