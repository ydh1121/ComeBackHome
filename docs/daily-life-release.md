# PR #94 release preparation

Status: prepared, NOT executed. Current production MAIN is `d4dcf1abb802e419e85bb9769e5a8b0ad3d96010`. This release requires the owner's approval for the new `0011` schema and PR #94 rollout. Prior PR #92 / #93 approval is not reused as a fresh migration authorization.

## Exact change to approve

Apply `db/migrations/0011_person_birthdays.sql` to the existing `come-back-home-db` (`5b5d6397-042c-465b-8411-9e67555eaeb4`), then merge the accepted PR #94 revision and deploy the existing canonical Pages project, `come-back-home`. Birthday planning runs inside Pages. The existing minimal scheduler only calls the Pages tick endpoint and needs no code change. No new Worker/Pages project or paid service.

The schema adds only these fields:

| Table | Column | Existing-row default |
| --- | --- | --- |
| people | phone | NULL |
| people | birthday_json | NULL |
| notification_settings | birthday_days_json | `[]`, all birthday reminders OFF |

No existing people, schedules, routes, import receipts, notification preferences or Push subscriptions are deleted. User-triggered schedule deletion remains a separate explicit in-app action. The new birthday rules use the existing outbox and encrypted Push delivery. This rollout does not send a test notification or manipulate iPhone Clock alarms.

## Execution order after approval

1. Pin the approved PR head and require its complete Phase 5G run: 12 required jobs SUCCESS, including both real Paddle browser runs. Preserve the separate nonblocking Generic OCR FAIL results.
2. Read the actual canonical Pages D1 binding, existing scheduler target/Cron, deployed revisions and migration ledger. Require exactly `0001` through `0010` and the matching existing database. If `0011` is already present, verify its schema and skip application. Any other baseline stops the rollout.
3. Take a fresh D1 Time Travel bookmark and encrypted backup using the previously verified backup recipient. Keep plaintext only in the private ephemeral execution environment. Verify durable encrypted-file readback and record its SHA; publish only schema/count/fingerprint evidence. Do not upload raw person, contact or schedule values to GitHub or public CI artifacts.
4. Rehearse this exact migration against the private backup. Compare every pre-existing column in every protected table before/after; check SQLite integrity and foreign keys. The existing automated synthetic rehearsal is evidence for the software, not a substitute for this fresh production backup check.
5. Verify the production baseline still matches the backup fingerprint. Apply only `0011` and its migration ledger entry. Do not invoke the old PR #92 rollout or replay `0009`/`0010`. Any general migration command must first prove that `0011_person_birthdays.sql` is the sole pending file.
6. Read back the three new columns and their defaults. Compare pre-existing-column fingerprints again. On mismatch, stop before deployment; do not automatically restore or delete production data.
7. Merge the exact approved PR head. Deploy to the existing canonical Pages using the normal project configuration. Wait for `/api/health` to serve the new MAIN commit. Preserve the unchanged minimal scheduler and its existing Cron. Do not dispatch the scheduler deployment workflow: its verification step actively POSTs a scheduler tick and could deliver real due notifications.
8. Run read-only Chromium/WebKit production checks for Today, schedule/history, import file selection, people and notification/cache settings. Block application writes in those checks. Do not call native `tel:` / `findmy:` URLs, send Push, submit real images or change schedules for testing.
9. Record actual MAIN, PR head, required CI, migration ledger, Pages and scheduler revisions, and read-only result in all four durable documents. Keep real iPhone Find My opening and notification receipt as user verification, separate from browser acceptance.

## Failure recovery

If the new app fails after schema application, restore the previously deployed Pages and scheduler code revisions. The additive nullable/default-OFF columns are compatible with the old code and can remain. Do not drop columns or restore an entire live database without a separate reviewed decision, because later user edits could be lost. No release step should delete user schedules automatically.

## User-visible verification after rollout

The user only needs to reopen the PWA and review the new screens. Birthday/phone are optional profile fields; birthday reminders stay OFF until enabled. Find My is a best-effort app-opening link and requires an actual iPhone check. It does not obtain or infer location. No shortcut installation is needed for these changes.
