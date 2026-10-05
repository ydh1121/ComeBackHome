# ComeBackHome Notification Job Generation Policy — Phase 5S

Status: POLICY FIXED / JOB PLANNER IMPLEMENTED / LIVE PUSH STILL DISABLED

Phase 5S closes D-006/D-238 with the user-approved v1 notification-generation semantics.

## Shift-end notification

For each enabled work schedule on the current Asia/Seoul date:

- create one logical shift-end job;
- schedule it for the registered shift end time;
- dedupe by person + work date;
- title the event as a planned shift end, not confirmed departure;
- include the planned shift end time;
- include the current home-arrival estimate when available;
- include the next enabled work date/time when available.

If ETA is unavailable, the message states that the home-arrival estimate needs confirmation rather than inventing a time.

## ETA-change notification

ETA-change notifications require the notification setting to be enabled and a valid ETA observation.

Policy:
- first valid ETA on each work date initializes the baseline only;
- notify when the current ETA differs from the last notified/baseline ETA by at least 10 minutes;
- after an ETA-change notification, suppress another ETA-change notification for 15 minutes;
- during cooldown, the notification baseline is not silently advanced;
- after a notification, the new ETA becomes the baseline;
- each new work date resets the baseline;
- no ETA-change job is created on a non-work day.

LIVE confidence may be labeled realtime. STALE/FALLBACK observations remain explicitly expected/estimated and are never presented as LIVE.

## Home-arrival notification

There is no home-arrival notification in v1.

No GPS/geofence or explicit arrival signal exists, so the system must not claim that the person arrived home.

## Next work information

The shift-end notification includes the next enabled schedule after the current work date.

If none exists, the message states that no next work schedule is registered.

## Persistent planner state

D1 migration 0002_notification_planner_state.sql adds one row per person containing:
- ETA baseline timestamp;
- work date associated with that baseline;
- timestamp of the last ETA-change notification;
- state update timestamp.

The work-date field prevents a previous workday ETA from triggering a false change alert on a later workday.

## Current activation boundary

Phase 5S implements generation contracts and deterministic tests only.

It does not:
- configure a live PushDeliveryGateway;
- configure VAPID keys;
- enable PUSH_DELIVERY_ENABLED;
- wire a live ETA source into the Worker scheduled event;
- create a remote Cron trigger;
- apply migration 0002 to remote D1;
- deploy Cloudflare.

The production Worker scheduled entry remains fail-closed until live notification dependencies are explicitly configured.
