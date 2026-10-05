# ComeBackHome Kakao HTTPS Network Transport — Phase 5M

Status: CODE PATH READY / RUNTIME DISABLED / NO LIVE CALL EXECUTED

Phase 5M adds the first real network-capable provider transport, but it remains inactive under the existing PROVIDER_RUNTIME_ENABLED=0 gate.

## Network transport

SecureProviderJsonTransport:
- accepts an injected fetch function
- calls the Phase 5L activation security gate before resolving a secret
- materializes path/query/header authentication only after security passes
- performs a final HTTPS protocol assertion
- requests JSON only
- emits sanitized HTTP failure messages that omit provider body and credential values

## Secret resolution

ObjectProviderSecretResolver can resolve Worker-side secret bindings only inside the network-transport layer. Source clients continue to carry only secret-name references.

Repository source contains secret binding names, never provider credential values.

## Worker wiring

createProviderRuntime returns null unless PROVIDER_RUNTIME_ENABLED equals 1.

When disabled:
- no source client bundle is created
- no provider fetch can occur
- existing /api/providers endpoints continue returning disabled behavior

When enabled in a future authorized environment:
- Kakao place search and public-transit route endpoints can use the secure transport
- missing Kakao secret fails closed before fetch
- Seoul bus/subway clients still fail at the Phase 5L security gate because their documented request plans are not TLS_VERIFIED

## Seoul boundary

Phase 5M does not bypass the Seoul secure-path blocker. Worker transit-access, bus-arrival and subway-arrival API surfaces return an explicit secure-transport-unavailable response even if provider runtime is enabled.

## Verification

Tests use:
- injected fake fetch
- a clearly non-production fixture secret
- Phase 5J fixture responses

The test proves request URL/query/header materialization and mapper integration without contacting any external provider.

## Safety boundary

PROVIDER_RUNTIME_ENABLED remains 0 in local config. No real credential is configured. No authenticated provider request is executed. No remote resource or deployment is authorized.
