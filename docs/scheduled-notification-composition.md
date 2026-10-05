# ComeBackHome Scheduled Notification Composition — Phase 5T

Status: COMPOSITE SCHEDULER READY / LIVE DEPENDENCIES NOT CONFIGURED

Phase 5T composes the Phase 5S notification planner and the Phase 5R outbox processor into one scheduled-cycle contract.

## Composite cycle

runScheduledNotificationCycle performs:

1. activation gate;
2. notification job planning;
3. due outbox processing.

The same injected NotificationJobStore is expected to back both planning and delivery so a job created as due in the current cycle can be claimed and delivered immediately.

Future shift-end jobs are created once through their dedupe key and remain pending until scheduled_for is due.

## Activation behavior

PUSH_DELIVERY_ENABLED remains the top-level activation gate.

- flag != 1 -> status disabled; no planner call and no outbox claim;
- flag = 1 but dependencies absent -> status not-configured; no planner call and no outbox claim;
- flag = 1 and dependencies injected -> status processed.

The production Worker scheduled entry now points at runScheduledNotificationCycle but passes no live dependencies. Therefore the current production path remains fail-closed even if code is deployed.

## Planning failure isolation

Planner failure does not prevent delivery of already-enqueued due jobs.

The cycle records a sanitized planningError, leaves planning null, and still runs processNotificationOutbox.

This prevents a temporary ETA/planning-source failure from blocking a previously planned shift-end or retry job.

## Verified cycle behavior

The deterministic test covers:

- shift-end job planned and delivered in the same due cycle;
- next-work data survives through the delivered payload;
- first ETA initializes baseline only;
- a later +10 minute ETA change creates and delivers one ETA-change job;
- replanning does not duplicate the shift-end job;
- 15-minute ETA cooldown suppresses a new alert;
- disabled cycle performs zero planning and zero claiming;
- enabled-but-unconfigured cycle performs zero planning and zero claiming;
- planner exception still permits a pre-existing due outbox job to be delivered.

## Safety boundary

Phase 5T does not provide or configure:

- VAPID keys;
- a real PushDeliveryGateway;
- a production retry policy;
- a live Worker NotificationEtaSource;
- PUSH_DELIVERY_ENABLED=1;
- a remote Cron trigger;
- remote D1 migration/application;
- Cloudflare deployment.

Live activation remains a separate explicit decision.
