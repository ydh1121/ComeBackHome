# Materials and management closeout

User instructions on 2026-10-28 authorize the remaining software implementation, MAIN merge and canonical deployment after verification. Repository visibility remains the owner's decision. This document records scope and evidence; it is not a whole-project or real-device acceptance declaration.

## Verified baseline and current delta

PR108 baseline `4f91d85eba42fe89b90fc270ce9849b696e8d34c` has 535 passing local contract/model checks, client/worker typechecks, [12 required product jobs](https://github.com/ydh1121/ComeBackHome/actions/runs/40557273432) and [3 private-module jobs](https://github.com/ydh1121/ComeBackHome/actions/runs/40557273261). Chromium/WebKit, isolated D1 and synthetic Drive passed; 86 synthetic screenshots were captured and representative layouts inspected. This evidence is preserved.

The subsequent v2 specialist mapping, reviewed Drive organization and authenticated result receiver are **IMPLEMENTED**. The combined local typechecks and contract/model suites pass; deployment acceptance additionally requires their exact-source browser/CI gates. Baseline results do not establish acceptance of those changes. Read the latest PR and durable release evidence for the deployed SHA.

## Ordinary user workflow

[자료·메모 사용 안내](materials-help.md) explains the user steps. No new API key, paid inference or integration installation is required for the ordinary workflow:

1. Upload multiple originals or save multiple memos.
2. Select sources and prepare one GPT request.
3. Send the request to ChatGPT; provide private originals only through a user-authorized access route.
4. Import the returned JSON file or paste its JSON, then review the proposed entries.
5. Explicitly save selected new entries. Separately review and apply proposed file organization when wanted.

## Implemented contracts under verification

| Area | Product behavior |
|---|---|
| Originals | Up to 20 PDF/PNG/JPEG/WebP files, 20 MB each and 100 MB per batch. Existing resumable upload, integrity/revision/permission checks, progress, cancellation and failed-file retry. Successful files release their browser File references. Leaving the screen aborts the active queue. |
| Memos | Multiple UTF-8 TXT/MD files or pasted text, reviewed before bounded atomic import. Identical retry does not duplicate entries. Editable memos remain distinct from immutable originals. |
| Request | One selected-source request, verified original links and note revisions. Creating or copying it does not call an LLM or transmit the files automatically. |
| Result | `cbh-analysis/v1` stays compatible. `cbh-analysis/v2` adds all existing 19 record kinds and optional file-organization proposals. Maximum 40 entries, 20 moves, 180,000 UTF-8 bytes. Missing required facts must become a memo/question, not invented field values. |
| Record safety | Every analysis entry is saved as reported information. Official statuses, protected dates/counts, confirmed flags and policy references are held as readable proposed text instead of becoming authoritative fields. No payment-ledger event or policy is imported through this route. Existing record/source/link validation, explicit approval, atomic writes and duplicate-safe insertion remain in force. |
| Drive organization | A separate explicit action moves only selected verified originals into app-managed category folders directly within the existing private root. No arbitrary destination, sharing change, deletion or content replacement. An encrypted per-file journal precedes the remote move. Retry checks whether a move already completed and verifies integrity/privacy before committing its new DB location. |
| External result receiver | Optional short-lived, source-scoped bearer capability stages one result for review. It does not authorize source download, case-record application, Drive movement or payment changes. Normal ChatGPT conversations do not gain HTTP-calling capability from the existence of this endpoint. |
| Management | Preparation, application/treatment, employment, money and materials share a compact navigation list. Existing specialist creation, revision/history, conflict, archive, policy and ledger tools remain available. |
| Guidance | Existing editable guidance and original-preserving personal-history review remain. Classified private preparation is an explicit administrator action; it is not a runtime seed. |
| Payments/calculations | Guided payment entry retains append-only events and lost-response-safe retries. The six calculators retain their existing formulas and verified-policy requirements. Unknown values stay distinct from zero; estimates do not create decisions or deposits. |

See [analysis exchange/API contract](analysis-handoff.md) for precise machine boundaries.

## Failure and recovery

- Invalid JSON clears the candidate preview; a failed save preserves the reviewed input.
- Source documents outside the case or changed source notes are rejected. A callback is bound to the issuing session, account authorization and source snapshot.
- Expired, revoked or already-used capabilities cannot submit a different result. An identical result retry is acknowledged without duplicate application.
- Drive organization reports each file independently. A partial batch is not presented as atomic success. Retry the same pending category to reconcile an uncertain move; the original is retained if Drive or D1 verification fails.
- Existing records are not overwritten by analysis import. A user's confirmation remains separate from an agency decision or confirmed medical finding.

## Required validation

- Existing materials/content/management model and browser suites remain, including upload failure/retry/cancel, UTF-8 limits, full source retention, explicit approval, conflict/history, duplicate replay and ledger rollback.
- New coverage must exercise v1 compatibility, v2 specialist normalization, malformed/foreign source rejection, file import, callback grant/auth/expiry/revocation/source changes and identical/different replay.
- Drive tests must cover explicit approval, allowed root/category boundaries, changed revisions/permissions, ambiguous remote responses, post-move DB failure and same-request recovery.
- The same final source must pass Chromium/WebKit with isolated D1 and synthetic providers, then both full product 12 and private module 3 CI gates. Canonical deployment additionally checks those exact-MAIN gates and exact `/api/health` SHA.
- Real iPhone, real private sources, external-tool configuration and live Drive moves remain separate evidence. Synthetic CI cannot establish them.

No calendar, OCR, commute, ETA or push business changes, schema migration, new provider, new site or paid inference are part of this closeout. The existing generic OCR diagnostic policy is unchanged.

## Design references

The existing ComeBackHome schedule list supplies spacing and concise actions. Apple Files supplies selection/common actions; Notion import supplies grouped import with review. These are interaction references, not copied assets or code.

- https://support.apple.com/en-ie/guide/iphone/iphab82e0798/ios
- https://www.notion.com/help/import-data-into-notion

No private examples, document names, case values, tokens or original screenshots belong in this repository or its CI artifacts.
