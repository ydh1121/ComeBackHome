# ComeBackHome Secure Provider Transport

Status: OFFICIAL SEOUL HTTP ALLOWLIST ACTIVE / SECRET-GATED

## Current official evidence

Kakao provider calls use documented HTTPS endpoints.

Seoul Open Data continues to document the Seoul bus endpoints under `http://ws.bus.go.kr` and the realtime subway endpoints under `http://swopenAPI.seoul.go.kr` / `http://openAPI.seoul.go.kr:8088`.

ComeBackHome does not treat arbitrary HTTP as trusted. The provider security gate allows documented HTTP only when all of the following are true:

1. request security is `DOCUMENTED_HTTP_REQUIRES_VALIDATION`;
2. the host is one of the explicit Seoul official hosts in source;
3. the request comes through the server-only provider transport;
4. the required provider secret is present.

Allowed hosts are:
- `ws.bus.go.kr`
- `swopenapi.seoul.go.kr`
- `openapi.seoul.go.kr`

Any other HTTP host remains blocked. Kakao remains HTTPS-only.

## Secret handling contract

Provider credentials remain Worker/Pages secrets. They are resolved only inside the server provider transport and are never returned to the browser, logs, repository source, or provider-status payload.

Required realtime secrets for final production activation:
- `SEOUL_BUS_SERVICE_KEY`
- `SEOUL_SUBWAY_API_KEY`

If either source fails or is unavailable, the application must degrade to route-based `FALLBACK` rather than fabricate realtime data.

## Activation policy

Failure reasons remain explicit:
- `INSECURE_ENDPOINT`
- `UNVERIFIED_TRANSPORT`
- `MISSING_SECRET`

The official Seoul HTTP exception is host-allowlisted, not protocol-wide.
