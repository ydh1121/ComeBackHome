# Private work injury and employment module

Implementation track v0.7, 2026-10-24. Base: `de7c548502171c4cce63b0162358b3dac5821304`.
Initial implementation hold was superseded by the owner's explicit MAIN/PWA login rollout request. Narrow login fixes may follow required CI through the existing canonical deployment; unrelated production changes remain outside that scope. See rollout history and the password server-relief boundary below.

## Phase 0

- Existing React/Vite PWA, Pages Functions and D1; same-origin `/api` dispatcher. Existing private Worker only invokes the authenticated scheduler.
- No user authentication or ownership column currently exists. People, schedules, notification settings and subscriptions are a legacy shared workspace. Never silently assign or split existing records.
- Eleven existing migrations, independent reusable primitives in `packages/portable`. Preserve existing business repositories, OCR models and notification scheduler.
- Required baseline CI has 12 successful jobs. Existing generic OCR diagnostic failures retain their nonblocking classification.
- Repository is public. No private planning text, identifiers from evidence, original documents, actual credentials or provider tokens in source/fixtures/CI.
- Planning v0.1–v0.7 inspected. The owner's latest implementation instruction supersedes historical planning holds and the old no-login rule; release holds remain.

## Minimal integration

1. Authentication gate before application services initialize, preventing pre-login data requests.
2. Server gateway before the existing API dispatcher; internal scheduler retains its separate credential contract. Health may remain public without user data.
3. `/injury` route, app-owned floating entry and account/settings link. Existing page layout and business logic preserved.
4. Cache invalidation and view teardown at identity changes. Private responses use no-store and never use the legacy read cache.
5. Additive `auth_*` and `case_*` tables only. No alteration/deletion of existing tables or production data.

## Boundaries

`src/modules/auth` owns the session client and login UI; `worker/modules/auth` owns credentials, sessions, CSRF, throttling and audit. Password verification remains server-side. No public registration or reset endpoint. Random user IDs, not login names, are authorization principals.

`src/modules/injury` owns application contracts, pure calculations and UI. `worker/modules/injury` owns case ACL, revision-checked repositories, policies, documents and ledger. Only generic portable primitives may be shared with the original PWA. No imports of existing schedule/commute/OCR repositories.

The case owner grants/revokes administrator access explicitly. Account preferences remain personal. Legacy workspace membership is a separate provisioning decision, never inferred from the case role. The owner approved both accounts sharing the existing workspace, and confirmed their grants. The owner activated authentication; canonical Pages now defaults to protected mode if the flag is absent. An explicit `0` remains a deliberate rollout rollback, not an automatic error recovery.

## Password runtime correction

Production rejected the original server-side 600k PBKDF2 operation despite local workerd success. [Server relief and atomic credential upgrade](password-server-relief.md) preserves the browser's 600k derivation and adds a separate salted 10k server verifier. Server-side credential/session verification remains mandatory. Existing Windows credentials upgrade in-app without re-registration or schema migration. The protocol's password-equivalent material, client policy limitation and incompatible-old-code rollback boundary are documented explicitly.

## Persistence

- Auth: users/credentials, hashed sessions, rate limits, preferences, workspace grants, audit and policy.
- Case: profile/consent, revisioned content, typed workflow records, immutable revisions, append-only payment events, versioned legal policy, document metadata/upload journal, deadlines and audit.
- Typed record categories cover claim intake/events/opinions/investigation, treatment/extension/expense/disability, employment/paid days/resignation/agency replies, payroll/exposure/simulations/severance/leave/incidents and unemployment recognition. Shared storage mechanics do not merge their domain validation.
- D1 batch/conditional revisions preserve atomic edits and prevent silent overwrites. Official decisions need source references; editable notes cannot promote policy or approval.

## Files

Prefer OAuth `drive.file` with explicit folder selection and resumable uploads directly to private Drive. Existing ChatGPT authorization is not PWA authorization. D1 records file ID, original size/digest, revision and verified ACL only. Tokens remain server-side. Upload sessions are not public download links.

If no Drive grant exists, keep the selected file on the user's device and offer retry; do not report it as stored. R2 is not provisioned for convenience. Any optional staging adapter must preserve the original until Drive ID/bytes/digest/ACL and D1 location commit all succeed, and separately retry cleanup failure.

## Acceptance

Independent calculation cases, authenticated D1/API tests, Windows PowerShell hash interoperability, actual workerd crypto probe, Chromium/WebKit at 375/390/768/1024/1440, login/expiry/revocation/CSRF/IDOR, consent revocation, long text sticky copy/edit/longpress, conflicts, upload cancellation/retry/checksum/ACL/deletion failures, migration rollback rehearsal and all existing 12 CI jobs.

Physical iPhone persistence, live OAuth/Drive grant, Workers Free CPU quota and production rollout are separate acceptance levels. Local timing is not production CPU evidence. Do not weaken hash settings, lower QA thresholds or create a paid/external service to turn a blocker green.

Deadlines are derived in-app guidance, as required by the v0.7 planning ledger. They do not dispatch the legacy commute Push/Outbox. Recommended inquiry dates never mean automatic claim approval. Treatment approval, incapacity, payment decisions and actual deposits remain separate records.

Policy preparation is in `policies/`; no policy or private planning content is silently seeded at runtime. A private 63-record planning import remains outside Git/CI and requires human review. The UI validates the file before approval and renders readable record previews. See [rollout and recovery](rollout-and-recovery.md) for the owner handoff.
