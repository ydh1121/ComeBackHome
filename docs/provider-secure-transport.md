# ComeBackHome Secure Provider Transport — Phase 5L

Status: SECURITY GATE DEFINED / SEOUL SOURCES BLOCKED FOR LIVE ACTIVATION

Phase 5L resolves the transport-security decision before any credential can be used.

## Current official evidence

Kakao's current REST documentation publishes HTTPS endpoints for both keyword place search and public-transit routing and requires the REST API key in the Authorization header.

Seoul Open Data's current Open API usage guide publishes API examples under http://openapi.seoul.go.kr:8088. Current Seoul bus dataset pages likewise publish request URLs under http://ws.bus.go.kr. The public-data portal listing for Seoul bus position service also identifies an http://ws.bus.go.kr service URL.

Phase 5L does not infer HTTPS support from host naming, redirects or browser behavior. Until an official secure URL/path is documented or otherwise explicitly validated without credential exposure, Seoul bus and subway requests remain activation-blocked.

## Activation policy

A provider request is activation-ready only when all conditions are true:

1. the request URL template is HTTPS,
2. request security is TLS_VERIFIED,
3. the required Worker secret is reported present by a secret-presence resolver.

No secret value is returned to the policy layer.

Failure reasons are explicit:
- INSECURE_ENDPOINT
- UNVERIFIED_TRANSPORT
- MISSING_SECRET

## Current source status

- Kakao place search: transport security ready; credential presence still required at activation time.
- Kakao public-transit route: transport security ready; credential presence still required at activation time.
- Seoul bus: activation blocked because the documented endpoint is HTTP.
- Seoul subway station/search and realtime endpoints: activation blocked because current Seoul Open Data examples use HTTP and a secure equivalent has not been proven.

## Secret handling contract

Phase 5L introduces only ProviderSecretPresenceResolver.has(secretName). It does not resolve, expose, log or serialize a credential value.

A future network transport may receive actual secrets only after:
- this security gate passes for the target request,
- the Worker runtime is explicitly authorized for live provider integration,
- secret values are configured outside repository source.

## Safety boundary

No fetch/network transport is added. No provider secret value is added. No authenticated live provider request is made. PROVIDER_RUNTIME_ENABLED remains 0. No remote Cloudflare resource or deployment is authorized.
