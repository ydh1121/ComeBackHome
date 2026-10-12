# Reviewed image import integration

PR #91 at `4ed6183d216e0e5e2c74e841afd0bd5f5fbd7976` supplies the weekly header reconciliation, recoverable missing dates, explicit Monday-to-Sunday confirmation, manual review and private original-image preview. These changes are integrated on PR #92 after its nonimage acceptance at `8076422f5578f5a218761edfd44987757079a2bd`. PR #91 itself remains unchanged, draft and unmerged.

Image review uses the existing `PUT /api/workbooks/approved-import` transaction. There is no second weekly database writer. The request contains `source: WEEKLY_IMAGE`, a confirmed Monday, all seven day indices per included employee, explicit per-row decisions, pending employee names and current schedule snapshots. Date, person and time corrections revoke approval. Confirming dates reloads the existing schedules before review. The server rejects incomplete dates, unapproved OFF, unreadable required breaks and stale snapshots; employee creation, schedules and the idempotency receipt succeed or roll back together. Image evidence participates in the request digest without changing legacy XLSX fingerprints.

Physical row/day ownership and the three source cell bounds follow each candidate into review. The whole image and corresponding cell crop can be viewed through a browser-only object URL. Image URLs are never persisted or uploaded; commit, cancellation, failure, a replacement selection, leaving the import flow and page exit release them. Unsupported geometry is labelled manual entry, not OCR success. Actual decoder/model failures remain errors.

Validation uses the existing synthetic image/Paddle suites and isolated local D1 harness, plus `verify-ocr-approved-review.mjs`. Synthetic browser acceptance, local D1 and real external provider accuracy are separate results. The existing v2 evaluator and its 12-image/336-cell private corpus have not been recreated or uploaded to GitHub.

External evaluation is blocked: Cloudflare's authenticated login submission returned HTTP 403; Gemini AI Studio observation was blocked by credential protection after the documented origin recovery; no owner-authorized OCR.space key is available. No external OCR inference was run. Model selection, independent v2 accuracy, account quota and inference usage/latency remain unmeasured. Existing local Paddle results are not a substitute for those measurements.

`RELEASE_HOLD_UNTIL_OWNER_APPROVAL` remains in force. This integration does not authorize production migrations/deployment, live messages, native iPhone alarm changes or commute trials.
