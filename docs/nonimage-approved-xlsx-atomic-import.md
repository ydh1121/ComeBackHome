# ComeBackHome — Approved native XLSX import / production migration HOLD

## Scope and authority
Workstream: D-CBH-20261010-NONIMAGE-COMPLETION-FIRST-001, Draft PR #92.
Canonical origin remains `https://come-back-home.pages.dev/`.
Image OCR PR #91 remains a separate unmerged draft. D-440 and F01–F09 HOLD.

The new `PUT /api/workbooks/approved-import` is a same-origin-only Worker handler. Reviewed native XLSX rows, pending new employees, schedule mutations, and an idempotency receipt are written in **one D1.batch transaction**. A failed assertion or database constraint must abort the entire batch. The client only marks an import completed after receiving a persisted receipt and independently reading back the affected schedules. Drafts are browser-local and are not an authorization or cryptographic approval token.

## Migration design / local testing
Actual migration: `db/migrations/0009_approved_workbook_import_receipts.sql`.
It creates `approved_workbook_import_receipts(request_id PRIMARY KEY, payload_digest, receipt_json, created_at)`, plus `approved_workbook_import_checks(request_id, ordinal, passed CHECK(passed=1))`. The checks table stores atomic SQL precondition assertions for existing schedules, missing schedules and existing people. Receipts store deterministic created-person mapping, affected schedule keys and a response snapshot. The ledger and assertions are **not** an OCR migration.

Two triggers reject new person insertions and renames that duplicate existing names under the SQL trim/lower/space-normalized comparison. Existing duplicate people are not altered. Existing records with different Unicode normalization may still require manual review; the server also performs NFKC/whitespace normalization before mutation.

Only local Wrangler D1 migrations are permitted during this work order. All synthetic checks use a temporary `--persist-to` directory deleted after execution.

## Replay and concurrency policy
- Same request ID and normalized digest: return stored receipt, zero additional updates.
- Same request ID and different payload: HTTP 409, zero writes.
- New request against an already changed schedule: same-transaction SQL precondition failure and rollback. A prior request replay cannot overwrite subsequent manual edits.
- New pending employee names: checked against known employees and guarded by SQL triggers; concurrent distinct requests cannot both create the same normalized employee.
- Invalid or missing approval, unapproved OFF, duplicate person/day, invalid clock/date/break or unknown existing employee: reject before mutation.
- The server accepts an explicit approval flag plus every row's explicit resolution. Because draft parsing is local, it cannot cryptographically attest that a human clicked the button; browser E2E and final review gating remain mandatory.

## Production application — requires separate user approval
**Do not run** `wrangler d1 migrations apply ... --remote` or modify production bindings as part of PR #92.
Before any authorized production rollout: (1) back up the current production D1 schema/data to the approved Drive backup area; (2) examine existing duplicate employee names and migration compatibility; (3) ensure canonical Worker/API deploy and migration compatibility; (4) apply migration only with explicit user authorization; (5) run a read-only health/preflight and a separately authorized minimal write acceptance. No new public Worker, Pages project or alternate origin is necessary.

### Rollback and recovery
If production deployment is declined, do nothing; no remote data was changed.
If migration was separately approved/applied, pause importing and restore from the pre-migration **Drive-backed** D1 backup if rollback of data is required. Only after preserving/exporting all receipt rows and ensuring that the deployed API no longer needs them, schema-only rollback SQL is:

```sql
DROP TRIGGER IF EXISTS cbh_people_reject_duplicate_update;
DROP TRIGGER IF EXISTS cbh_people_reject_duplicate_insert;
DROP TABLE IF EXISTS approved_workbook_import_checks;
DROP TABLE IF EXISTS approved_workbook_import_receipts;
```

Do not drop the receipt ledger while a deployed client/backend can still replay approved requests; doing so would destroy the idempotency contract. Use a new, audited forward migration for production remediation rather than changing an already-applied numbered migration.

## Release gate
Keep PR #92 Draft until successful current-HEAD synthetic XLSX binary/vertical regression, review & reapproval, local D1 transaction and negative controls, Chromium and WebKit actual product upload→approval→D1→reload, and required existing CI. PROD_D1_MIGRATION=HOLD, CANONICAL_DEPLOY=HOLD, IPHONE_REAL_LIFE_E2E=HOLD, OCR=DEFERRED.
