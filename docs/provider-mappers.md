# ComeBackHome Fixture-backed Provider Mappers — Phase 5J

Status: COMPLETE SOURCE-MAPPING TARGET / NO LIVE ACTIVATION

Phase 5J converts documented provider response fields into ComeBackHome normalized provider contracts without credentials or network requests.

## Mapper coverage

- Kakao keyword place response -> PlaceSearchResult
- Kakao public-transit route response -> TransitRouteResult
- Seoul bus stop response -> TransitSearchResult
- Seoul bus arrival response -> Arrival
- Seoul subway station-name search -> TransitSearchResult
- Seoul realtime subway arrival -> Arrival
- Seoul realtime train position -> SubwayTrainPosition

## Route contract repair

The prior TransitRouteProvider contract returned domain RouteCandidate, which requires personId even though a provider route lookup receives only origin/destination coordinates. Phase 5J introduces TransitRouteResult without personId. Application code can attach personId only when provider results are promoted into a person's route-candidate context.

## Kakao mapping

Official Kakao public-transit documentation defines route totalTime and step time in seconds, transfers as a count, fare.value in KRW, and WALKING/BUS/SUBWAY step types. Therefore:

- totalMinutes = ceil(totalTime / 60)
- walkMinutes = ceil(sum(WALKING step time) / 60)
- transferCount = transfers
- fare = fare.value
- steps use guidance text and normalized mode
- route id is a deterministic adapter hash of documented route structure, not a transient ETA or list index

Official keyword-place fields map id, place_name, road_address_name, address_name, x, y and category_name directly.

## Seoul bus mapping

Bus-stop fixture uses the service's stop identifiers and WGS84 stop fields. stId is the provider identifier, arsId is the displayed stop code and stNm is the canonical stop name.

Bus arrival mapping reads first/second expected-arrival seconds and vehicle identifiers from the documented response family. mkTm is retained as the provider observation timestamp. The mapper never derives an arrival from display text.

## Seoul subway mapping

Station-name search uses STATION_CD, STATION_NM, LINE_NUM and FR_CODE.

Realtime arrival uses barvlDt seconds, btrainNo and recptnDt. Realtime train position uses trainNo, subwayNm/subwayId, statnNm, recptnDt, updnLine, statnTnm, trainSttus and directAt.

Seoul timestamps in YYYY-MM-DD HH:mm:ss are normalized with an explicit +09:00 offset. No current-clock substitution occurs in the mapper.

## Fixture policy

Fixtures are small deterministic payloads shaped from public provider documentation/examples. They are not captured live responses and contain no credentials.

Behavior verification loads the TypeScript mapper through Vite SSR and asserts the normalized result. The mapper source is also checked for network-call, provider-secret and live-endpoint leakage.

## Safety boundary

No fetch call is implemented in mapper code. No provider key value is present. PROVIDER_RUNTIME_ENABLED remains disabled. Phase 5J does not authorize live provider calls, remote Cloudflare changes or deployment.
