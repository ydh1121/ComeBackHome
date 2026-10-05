# ComeBackHome Provider-backed Commute Runtime — Phase 5N

Status: APPLICATION PIPELINE READY / LIVE PROVIDER ACTIVATION STILL DISABLED

Phase 5N connects the existing route/realtime provider contracts to application repositories without putting provider logic in pages or queries.

## Repository boundary

ProviderCommuteRepository wraps persisted commute state and a TransitRouteProvider.

Persisted responsibilities remain unchanged:
- access points
- selected bus route
- route preference
- preferred route-candidate id

Runtime responsibilities:
- read origin/destination coordinates from PlaceRepository
- request route candidates from TransitRouteProvider
- attach personId only after provider results enter application context
- normalize missing walkMinutes to 0
- rank deterministically by total minutes, transfer count, walk minutes and id
- return an empty runtime candidate set when provider routing fails

Provider result ids stay runtime/source ids. No transient ETA value becomes route identity.

## Today ETA pipeline

ProviderTodayRepository combines:
- today's schedule
- provider-backed route candidates
- persisted preferred route id
- selected origin access point
- realtime bus/subway arrival observations
- injected clock
- optional injected RealtimeFreshnessPolicy

Base arrival calculation is deliberately conservative:

departure = max(current time, today's enabled shift end)
arrival = departure + route.totalMinutes

Realtime data does not silently alter route travel duration in Phase 5N because no calibrated mapping from arrival observation to route-total correction has been approved.

## Freshness policy

Phase 5I intentionally deferred a fixed LIVE/STALE threshold until authenticated evidence exists. Phase 5N preserves that rule.

- with no injected freshness policy, a valid route ETA is FALLBACK
- a deterministic fixture/test policy may classify an observed timestamp LIVE or STALE
- provider failure keeps the route ETA but returns FALLBACK
- no route returns UNKNOWN and no arrivalTime

This prevents fake realtime confidence while making the application seam ready for a later calibrated policy.

## Runtime composition target

When providerMode=api in a later wired composition:
- route candidates should use HttpTransitRouteProvider
- realtime bus/subway should use HttpRealtimeBusProvider / HttpRealtimeSubwayProvider
- persisted commute remains Worker/D1-backed
- providerData remains visibly worker-api
- default provider mode remains mock

Phase 5N itself does not enable PROVIDER_RUNTIME_ENABLED, inject provider credentials, perform live authenticated calls, mutate remote Cloudflare resources or deploy.
