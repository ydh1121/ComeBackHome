# ComeBackHome Provider API In-process E2E — Phase 5O

Status: CLIENT/WORKER/APPLICATION CONTRACT VERIFIED / NO LIVE ACTIVATION

Phase 5O verifies the complete provider-facing application seam without an external network request.

## Harness path

The test uses the actual production modules in this order:

HttpJsonClient
-> HttpDataProviders
-> Worker handleApiRequest
-> injected fake ProviderSourceBundle
-> normalized provider response
-> ProviderCommuteRepository
-> ProviderTodayRepository

The global fetch seam accepts only same-origin-style /api requests and throws on any unexpected external URL.

## Verified Kakao path

With a fake provider runtime injected and the Worker provider flag logically enabled inside the test only:

- place search crosses client -> Worker -> fake Kakao source
- route search crosses client -> Worker -> fake Kakao source
- ProviderCommuteRepository attaches person ownership and ranks runtime routes
- ProviderTodayRepository uses the selected provider route to calculate fallback ETA

No Kakao credential is resolved because the fake ProviderSourceBundle is injected after the network-transport boundary.

## Verified Seoul degradation

Worker transit-search, bus-arrival and subway-arrival routes remain security-blocked.

The E2E test proves:
- client adapters receive the explicit secure-transport-unavailable error
- blocked calls do not invoke the injected Seoul fake sources
- Today catches the blocked realtime request and retains the route-based ETA as FALLBACK

This confirms that Kakao route availability can coexist with unavailable Seoul realtime without fabricating LIVE status.

## Disabled provider contract

The harness then disables the logical Worker provider flag and verifies place search returns Provider runtime is disabled without invoking the fake Kakao source.

## Safety boundary

The harness does not configure Worker provider secrets, does not instantiate SecureProviderJsonTransport, does not call any external provider endpoint, does not mutate Cloudflare resources and does not deploy.
