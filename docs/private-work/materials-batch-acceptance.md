# Materials and management continuation

Base: MAIN `3ce0d3987a0ba7e7fd3ebc6e94754271cc6acef8`, after PR107's accepted canonical deployment. This patch adds no migration, provider, site, credential or production-data operation. It does not change the calendar, OCR, commute, ETA or push modules.

## Work sequence

1. Close the existing release and audit remaining public test-example material. Preserve repository visibility; the owner will change it after overall acceptance.
2. Add multiple-original upload and multiple-memo registration, then prepare one analysis request from selected files and notes.
3. Consolidate documents and memos into one list, introduce a task-oriented management index, and disclose detailed record fields only when needed.
4. Validate model rules, browser interaction and local D1, inspect synthetic mobile/desktop screenshots, then run the existing required regression.
5. Record exact source/CI and hand off the review build. This feature branch requires its own merge/release decision; the earlier PR107 release is already complete.

## Product behavior

- Select up to 20 PDF/PNG/JPEG/WebP originals, at most 20 MB each and 100 MB per batch. Upload sequentially through the existing resumable route. Each file has a status, failed-file retry and cancellation. Ready duplicates are reverified; hashes, permissions and original revisions retain their existing server checks. Successful files release their browser File references. Leaving the screen aborts the active queue.
- Paste several memos or import multiple UTF-8 TXT/MD files. Review the text and save once. The existing bounded, atomic, duplicate-safe import stores editable reference records. Memos remain separate from immutable originals.
- Search/filter one materials list; select verified files and notes, and prepare one editable GPT request. This does not call an LLM, change sharing, move files or copy to the clipboard automatically. Each original's handoff link is verified through the existing authenticated endpoint. Notes include their source revision.
- Paste the structured GPT result, inspect proposals and explicitly save selected new tasks/reference memos. Invalid input clears the preview; failed saves preserve it. The server accepts only the draft schema, verifies original references and uses the existing atomic insertion/audit history. Repeated saves do not duplicate unchanged records. Existing records are never overwritten.
- Management opens as a compact list: preparation, application/treatment, employment, money, and materials. Access/history is secondary. Legacy URLs remain supported. All original record kinds, revisions, conflicts, archives, policy and ledger tools remain available. Detailed fields and calculations are progressively disclosed.

## Analysis integration boundary

`cbh-analysis/v1` is a draft exchange, not authority to modify the case. Its `suggestions` contain `type` (`memo` or `task`), `title`, `body`, `sourceIds`, and optional recommended `dueDate` for tasks. The UI cannot take approval from the file. The server additionally requires explicit approval and rejects decision/payment/policy fields. Medical, financial and legal decisions are not inferred from generated text.

Authenticated GPT-to-app callbacks, automatic Drive folder moves and mapping into all specialist record types are **not implemented**. They require a separate authenticated/reviewable command contract. The current workflow is selection → request copy → user submits to ChatGPT → result review → explicit batch save. No original is relocated during this workflow.

## Validation

### Advisor content and management continuation

- General action guidance can be edited without deployment through existing content records, with copy, long-press, revision history and conflict handling. Safe fallback guidance remains available before any seed is applied.
- Administrator preparation classifies private planning drafts as general guidance, personal review or held material. Selection alone does not write; explicit application fills missing entries and preserves existing edits. Personal review keeps the original draft and remains reported information, separate from diagnoses, decisions and payments. Private preparation files are not repository fixtures.
- Payment entry asks for the event, amount/date and supporting record in three steps. Corrections stay separate. A stable reference per draft makes a retry after a lost response duplicate-safe; a separate new deposit has a separate reference.
- The six existing calculations retain their formulas and policy validation. The UI helps select the sole applicable verified basis, keeps detailed conditions secondary, separates unknown results from zero, and clears results when inputs change. No estimate writes a decision or deposit.

- `verify-materials-model.mjs`: bounded input, MIME/size validation, UTF-8 request limits, strict result schema, reported-only records and recommended dates, one source-preserving request.
- `verify-private-work.mjs`: approval, ACL, session revocation, invalid/foreign source, mixed-invalid atomic rejection, transaction/audit rollback and replay.
- `verify-materials-ui.mjs`: actual Chromium/WebKit product UI with isolated D1 and synthetic Drive; multiple originals, partial failure, retry, duplicate, cancellation, multiple memo files, grouped handoff, review/cancel/edit/failure/replay, retained originals/records, 375/390/768/1024/1440 and dark mode.
- Existing advisor and private browser tests remain, including page-relative sticky copy and edit/history/conflict flows. Existing full PWA required CI remains unchanged.
- `verify-content-model.mjs` / `verify-content-ui.mjs`: classification, original preservation, reported-only personal review, seed replay, editable guidance and existing revision/conflict controls.
- `verify-management-model.mjs` / `verify-management-ui.mjs`: six calculations, missing/expired policy, zero-write estimates, payment review/cancel, lost response replay and retained ledger entries.

The real iPhone, real private originals and future automated classification are separate acceptance stages. Synthetic CI does not establish those outcomes.

## Design references

The existing ComeBackHome schedule list supplies spacing, concise rows and a small number of primary actions. Apple Files supplies the selected-items/common-action pattern; Notion import supplies grouped import with review. These are interaction references, not copied assets or code.

- https://support.apple.com/en-ie/guide/iphone/iphab82e0798/ios
- https://www.notion.com/help/import-data-into-notion

No private source examples, document names, personal case values or original screenshots belong in this repository or its CI artifacts.
