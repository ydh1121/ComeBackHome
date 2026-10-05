# ComeBackHome Local D1 Scheduled Notification E2E — Phase 5U

Status: LOCAL D1 E2E READY / LIVE PUSH NOT ACTIVATED

Phase 5U proves the scheduled notification pipeline against the actual D1 repository implementations rather than in-memory stores.

## D1 dependency composition

createD1ScheduledNotificationDependencies composes:

- D1PersonRepository
- D1ScheduleRepository
- D1NotificationSettingsStore
- D1NotificationPlannerStateStore
- D1NotificationJobStore
- D1SubscriptionStore

The same D1NotificationJobStore instance is shared by planner and outbox so a due job created by planning can be claimed in the same cycle.

Runtime-only capabilities remain injected:

- NotificationEtaSource
- PushDeliveryGateway
- NotificationRetryPolicy
- optional outbox batch size

No production values are invented for those runtime capabilities.

## Local-only Worker harness

worker/testing/phase5u-local.ts is referenced only by wrangler.phase5u.jsonc.

It seeds deterministic local-D1 product data, runs runScheduledNotificationCycle with fake runtime dependencies and returns persisted D1 job/planner state for verification.

The production worker/index.ts does not import or invoke the test harness.

## Verified D1 transitions

With a fresh local D1 persistence directory and migrations 0001 + 0002:

1. person, schedules, notification settings and one fake subscription are persisted;
2. first workday cycle creates the due shift-end job, initializes ETA baseline and delivers the job through a fake gateway;
3. notification_jobs persists sent + attempts=1;
4. planner state persists ETA baseline and work date;
5. +10 minute ETA change creates and sends one ETA-change job;
6. planner state advances baseline and last ETA-notification timestamp;
7. a later ETA change inside 15-minute cooldown creates no job;
8. non-work day creates no notification job;
9. next workday resets ETA baseline and creates a future pending shift-end job that is not claimed early.

## Isolation

The verification uses a temporary --persist-to directory and removes it after completion.

wrangler.phase5u.jsonc contains only a zero UUID placeholder and local preview database id. The test performs no remote D1, Cron, secret or deployment operation.

## Safety boundary

Phase 5U does not configure:

- VAPID keys;
- a live web-push sender;
- a live NotificationEtaSource;
- production retry timing/count;
- production PUSH_DELIVERY_ENABLED=1;
- remote Cron;
- remote D1 migration;
- Cloudflare deployment.

Live activation remains a separate explicit phase.
