# Trusted Presence Event Automation Contract

Status: NON-LIVE / setup contract only

ComeBackHome must not infer an actual departure or home arrival from ETA alone.
A trusted external event is required for literal "left work" and "arrived home" notifications.

## Event endpoint

POST /api/presence-events

Required header:

Authorization: Bearer <PRESENCE_EVENT_INGEST_TOKEN>
Content-Type: application/json

Body:

```json
{
  "eventId": "<unique event id>",
  "personId": "<ComeBackHome person id>",
  "type": "LEFT_WORK"
}
```

Allowed `type` values:

- `LEFT_WORK`
- `ARRIVED_HOME`

The endpoint is fail-closed:
- no configured server token -> HTTP 503
- wrong/missing bearer token -> HTTP 401
- invalid type/body -> HTTP 400
- accepted event -> HTTP 202
- repeated `eventId + personId + type` is idempotent at the notification-job layer

The token must never be placed in a URL query string.

## User notification rules

Presence events are independent from the scheduled and ETA-change notifications:

- `shiftEnd`: expected/scheduled shift-end notification
- `etaChange`: material ETA-change notification
- `leftWork`: trusted LEFT_WORK notification
- `homeArrival`: trusted ARRIVED_HOME notification

A trusted event is accepted but not queued when its corresponding rule is disabled.

## iPhone Shortcuts mapping

This is the intended native helper path while ComeBackHome remains a PWA.

### Work departure

1. Create a personal automation with the **Leave** location trigger for the workplace.
2. Configure it to run automatically without asking.
3. Add **Get Contents of URL**.
4. Method: POST.
5. URL: `https://<ComeBackHome-origin>/api/presence-events`.
6. Add header `Authorization: Bearer <token>`.
7. Send JSON with:
   - `eventId`: a unique value for that trigger execution
   - `personId`: the configured ComeBackHome person id
   - `type`: `LEFT_WORK`

### Home arrival

Use the same pattern with an **Arrive** trigger for the home location and `type: ARRIVED_HOME`.

## Activation boundary

This document does not authorize or perform:

- production token creation or secret provisioning
- Cloudflare deployment
- remote D1 migration
- Cron activation
- provider credential activation
- Web Push VAPID provisioning
- live event calls

Production setup requires explicit activation of the existing notification delivery stack and this presence-event ingest secret.
