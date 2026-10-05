# ComeBackHome Notification Outbox Processor — Phase 5R

Status: STATE MACHINE READY / LIVE PUSH STILL DISABLED

Phase 5R implements the notification_jobs delivery state machine without configuring a real Web Push sender.

## Existing architecture retained

The Phase 5D/5E decisions remain authoritative:
- one-minute Cron Trigger candidate
- D1 notification_jobs outbox
- unique dedupe_key
- due-job claim through D1NotificationJobStore
- push_subscriptions store
- PUSH_DELIVERY_ENABLED default off

Phase 5R does not create notification jobs. Notification delivery timing remains an open product decision.

## Processor

processNotificationOutbox receives injected:
- NotificationJobStore
- SubscriptionStore
- PushDeliveryGateway
- NotificationRetryPolicy
- optional batch size

It claims only due pending/retry jobs and processes the bounded batch.

## Delivery state rules

Successful delivery to at least one valid active subscription with no retry-class failure:
- markSent

Transient delivery failure:
- ask the injected NotificationRetryPolicy for nextAttemptAt
- if a timestamp is returned -> markRetry
- if null -> markFailed

Permanent delivery failure:
- markFailed immediately

Terminal subscription failure:
- deactivate that endpoint
- continue delivery to other active subscriptions
- if another valid subscription succeeds, the logical job may still be marked sent
- if no valid subscription accepts the notification, pass the logical failure through the injected retry policy

No active subscription:
- pass No active push subscription through the injected retry policy

## Retry policy

Phase 5R deliberately does not choose a production retry count or delay.

D-006 still leaves notification delivery timing open. Retry behavior therefore stays behind NotificationRetryPolicy.

Tests use a deterministic fake policy only.

## Production scheduler gate

runScheduledTick behavior:
- PUSH_DELIVERY_ENABLED != 1 -> disabled, no job claim
- PUSH_DELIVERY_ENABLED = 1 but no injected delivery dependencies -> not-configured, no job claim
- injected dependencies -> processor may run

The current Worker entrypoint supplies no live gateway or retry policy, so production/runtime source remains fail-closed even if someone accidentally changes the flag.

## Multi-subscription note

The current logical job is shared across subscriptions. A transient error on any active subscription causes the logical job to retry unless a future delivery policy changes that rule. Because visible push payloads already carry a stable notification tag, a later real sender can use that tag to limit visible duplicate impact.

Per-subscription delivery receipts are not added in Phase 5R.

## Safety boundary

Phase 5R does not:
- configure VAPID keys
- activate BrowserPushSubscriptionProvider
- instantiate a live PushDeliveryGateway
- define production retry intervals/counts
- define notification generation timing
- enable PUSH_DELIVERY_ENABLED
- configure a remote Cron Trigger
- mutate remote D1
- deploy Cloudflare
