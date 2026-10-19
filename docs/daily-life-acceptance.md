# Daily-life update — 2026-10-19

Implementation in progress; acceptance requires the exact-head integration run. MAIN stays d4dcf1a until the new schema and release are explicitly approved.

- Up to ten images are recognized sequentially. Each keeps its own date anchor, original object URL, person mapping, explicit approval and atomic receipt. Invalid files remain visible; cancellation clears every unfinished batch. No image upload to a provider or D1.
- The default roster selects the approved receipt with the greatest work date, using receipt creation time only as a tie breaker. Uploading an older roster preserves the newer one. Past work remains in monthly history.
- Schedule deletion previews the selected employee, dates and count, requires final confirmation, and uses a single SQL count-guarded deletion. Outbox claims reject deleted shifts. No automatic production deletion.
- Birthday and phone are optional. Solar Feb 29 falls back to Feb 28; a missing lunar leap month uses its ordinary month; a missing lunar day 30 uses day 29. These choices are shown in the form. Lunar conversion uses pinned korean-lunar-calendar 0.4.0, offline (supported through 2050). Its failed conversions never become dates.
- Birthday reminders independently select 7/3/1/0 days, default OFF, at 09:00 Asia/Seoul. They reuse the existing encrypted Push/outbox pipeline. Claim time checks current birthday and enabled rule; expired morning reminders do not burst later. No test Push is sent.
- Find My is a best-effort findmy:// app-opening link on Apple devices, not an integration that reads location. Native iPhone opening remains unverified. tel: is inspected in tests, never dialed.
- Local cache is enabled by default in the browser. Only bounded 60-second person/schedule/place/commute-configuration GETs are cached. ETA/provider data, settings, Push credentials, images and writes are excluded. Successful mutations clear cached reads. Clearing/turning OFF also clears app shell caches without unregistering the Push service worker, deleting server data or erasing import drafts. No expired schedule fallback or offline write replay.
- Transitions.dev skeleton/reveal, page slide and sliding-tab hooks are retained with app-specific layout overrides. Routes never mount twice. Reduced-motion and reduced-transparency preferences are respected; true long content remains scrollable.

## Verification and release boundary

New contract tests: scripts/verify-daily-life.mjs (real SQLite repository SQL, dates, outbox, cache, multi-image lifecycle). Browser tests extend Phase B, preserving the existing Phase A–G / F01–F08 / Paddle / XLSX gates. Legacy fixtures which mutate D1 outside the browser start with read caching OFF; the new cache flow explicitly exercises ON/OFF, hits and invalidation.

Migration 0011_person_birthdays.sql only adds nullable people.phone, nullable people.birthday_json and notification_settings.birthday_days_json default []. Local rehearsal preserves old columns. Production migration has NOT been applied; prepare backup/readback and request approval for this exact additional schema change before release. Existing 0009/0010 must not be replayed. No actual Clock modification, test Push, paid provider or private-image transfer.

## Source references

- https://github.com/usingsky/korean_lunar_calendar_js (MIT; 0.4.0 pinned)
- https://astro.kasi.re.kr/kor/life/post/calendarData?year=2027 — 2027 calendar data, updated 2026-06-30; lunar anchors and listed holidays/substitutes checked independently. This data page describes itself as calendar reference, not the formal notice.
- https://www.kasa.go.kr/bbs/BBSMSTR_000000000018/view.do?nttId=B000000003234Li6nD2 — 2027 official calendar notice.
- https://www.korea.kr/news/policyNewsView.do?newsId=148968328 — 2026 Constitution Day restoration.
- https://transitions.dev/detail.html?t=skeleton-loader-and-reveal and https://github.com/Jakubantalik/transitions.dev/tree/main/skills/transitions-dev — requested motion references, used in the product, not redistributed as a library.
- https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/PhoneLinks/PhoneLinks.html — telephone link contract.
- https://github.com/f/awesome-deeplinks — first-hand app Info.plist evidence for findmy://; no promise of official stable iPhone URL support.

Holiday colors are calendar annotations, never evidence that an unregistered day is OFF. Newly designated temporary holidays and later legal changes require a source update. Actual iPhone link behavior and real Push receipt are separate from software/browser acceptance.
