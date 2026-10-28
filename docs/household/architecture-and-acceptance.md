# Shared household module

This module adds cards, a ledger, salary planning and shared notes to the existing PWA. Schedule, weekly OCR, commute and ETA domain implementations are unchanged. The shared authentication shell gains module navigation; the existing schedule bottom navigation retains its routes and behavior.

## Storage and access

- The two existing authorized accounts share one private Google spreadsheet under the already connected private Drive root. Both may correct income and expenses. No real household contents belong in this repository, CI fixtures or screenshots.
- `drive.file` is sufficient for the app-created workbook and card images. Google Sheets API must be enabled in the **existing** Google project. No model API, paid service, new Cloudflare project or new OAuth scope is required.
- Sheets contains entity records, readable ledger columns, an append-only command receipt/history and day/week/month/year summaries. User strings are typed `stringValue`, never interpreted as formulas. Unexpected formula errors remain visible.
- D1 contains a shared coordination row, an encrypted in-flight command, bounded image-upload receipts, minimal reminder projections and encrypted push bindings. It is not a second financial ledger.
- App edits serialize by revision and lease. A Sheets atomic batch includes the financial effect and command receipt. Lost responses are reconciled against the exact expected post-write hash; a retry cannot apply repayment twice. Manual edits to source or mirrored Sheet cells stop synchronization instead of silently overwriting them.
- Private conditional reads validate the current session and Drive permissions before returning 304. A per-account local copy may render after authentication; failed refresh makes it read-only. Logout/account changes purge it. Service worker API caching stays disabled.

## Financial meaning

All amounts are integer KRW. Card opening values do not create fictional expenses. Credit and credit-mode mobile cards have a limit; debit/prepaid-mode mobile cards have a balance. Repayment, borrowing and transfers do not increase ordinary income or spending. Card-loan-funded repayment updates both card capacities in one command. Salary allocation is a plan, not a payment. Corrections retain the original record and audit trail.

## Reminders

The existing scheduler Worker sends two independently authenticated requests to the same Pages project. The dedicated `/api/internal/household-scheduler-tick` path and `channel: household` isolate the new outbox from legacy transit readiness and the per-invocation Free-tier request budget. The new path returns not-found on an older Pages release instead of invoking the legacy cycle twice. Existing schedule jobs and subscriptions are not repurposed.

Each user opts in on their own device. KST midnight ledger reminders and due shared notes have deterministic per-device keys, one-hour expiry, OFF/completion/time-change checks, session revocation and retry handling. Notification bodies do not include memo text or financial amounts. Upstream lost acknowledgements still have normal Web Push at-least-once delivery limitations.

## Rollout

Apply additive migrations `0013`–`0015` with the reviewed release, then deploy existing Pages and the existing scheduler Worker. Do not create a new Worker or change the origin. The previous release approval does not establish that new migrations or live household data were exercised.

In the app, start the household ledger once. If Sheets API is disabled, follow `/guides/household-drive-setup.html`. Then each device may enable its own household notifications. Actual private data, native Google formula evaluation and physical-device delivery require separately recorded runtime evidence.

## Capacity and recovery

Current limits are 50,000 commands or a 5 MiB working state, 5 MiB per card image and a 2 MiB persisted local cache. Overflow is explicit and never truncates records. Automatic historical workbook splitting is not implemented. A pending remote write may hold a five-minute lease; use the displayed recovery action after it expires. A native Sheet creation response lost during Drive indexing is recovered by its initialization marker; duplicate candidates stop setup for review.

## Evidence

- `verify-household-domain.mjs`: financial effects, correction, conflict, KST periods, reminder states.
- `verify-household-cache.mjs`: identity boundaries, corruption, expiry, storage failure and purge retry.
- `verify-household-storage.mjs`: isolated SQLite plus mocked Google APIs, receipt recovery, permission changes, formula injection and images.
- `verify-household-notifications.mjs`: isolated SQLite, encrypted device bindings, both accounts, retries and suppression; no real push.
- `verify-household-browser.mjs`: synthetic browser contracts, both engines, five widths and screenshots. Mocked Google responses do not prove actual Sheets service behavior.
- Existing required regression and private-work workflows remain required. Generic OCR diagnostics remain separate under the existing nonblocking policy.

Design references were reviewed as guidance: the existing schedule page, Apple/Stripe DESIGN.md, Jakub Krehel's MIT interface-polish skill, Korean UX writing guidance and the free Transitions.dev 3D tilt example. No paid components, proprietary fonts, private images or downloaded third-party skill packages were added.
