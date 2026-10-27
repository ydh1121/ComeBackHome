# Advisor v0.8 acceptance map

This is a test map, not a whole-project acceptance declaration. Previously accepted R1/R2 software results remain valid. The current R3/R4/R5 integration has **465 previously passing local contract/model checks**, plus **50 dedicated v0.8 gap checks passing locally**; exact-head Chromium/WebKit, local-D1 browser flow, screenshots and required regression results must be read from the PR checks and durable release evidence. A previous deployment or passing PR does not close these gates.

`PASS (prior)` identifies preserved, previously accepted coverage. `LOCAL_PASS` identifies current local assertions. `NOT_RUN` means that the stated dedicated test or real-world check has no accepted evidence. A nearby general invariant does not replace that missing test.

## Test pointers

- **R1**: [`verify-private-advisor.mjs`](../../scripts/verify-private-advisor.mjs), [`verifyAdvisorR1`](../../scripts/private-work/verify-advisor-r1-ui.mjs).
- **R2**: [`verifyAdvisorR2Model`](../../scripts/private-work/verify-advisor-r2-model.mjs), [`verifyAdvisorR2`](../../scripts/private-work/verify-advisor-r2-ui.mjs).
- **CONTENT**: [`verifyContentModel`](../../scripts/private-work/verify-content-model.mjs), [`verifyContent` / `verifyContentAdmin`](../../scripts/private-work/verify-content-ui.mjs).
- **MATERIALS**: [`verifyMaterialsModel`](../../scripts/private-work/verify-materials-model.mjs), [`verifyMaterials`](../../scripts/private-work/verify-materials-ui.mjs).
- **GAPS**: [`verifyV08GapsModel`](../../scripts/private-work/verify-v08-gaps-model.mjs): company replies, examination/SMS/closure boundaries and simulation window exits.
- **MANAGEMENT**: [`verifyManagementModel`](../../scripts/private-work/verify-management-model.mjs), [`verifyManagement`](../../scripts/private-work/verify-management-ui.mjs).
- **CONTRACTS**: [`verify-private-work.mjs`](../../scripts/verify-private-work.mjs): existing ACL, records, policy, ledger, deadlines, Drive and transaction contracts.
- **BROWSER**: [`verify-private-work-browser.mjs`](../../scripts/verify-private-work-browser.mjs): the isolated D1 runner and the helpers above, in both browser engines.
- **REGRESSION**: existing [`private-work-modules.yml`](../../.github/workflows/private-work-modules.yml) and [`phase5g-local-integration.yml`](../../.github/workflows/phase5g-local-integration.yml); exact source and run results belong in the release evidence.

## QA01–QA25

| QA | User-facing contract | Evidence and present status |
|---|---|---|
| 01 | Empty case immediately offers an action and usable wording | R1 empty home, no seed prerequisite: **PASS (prior)**. CONTENT fallback/replay: **LOCAL_PASS**, combined browser pending. |
| 02 | Three primary destinations and one leading action | R1 home/navigation: **PASS (prior)**; current integrated BROWSER pending. |
| 03 | Optional questions, unknown and later are valid paths | R1 profile model and browser reload/retry/defer: **PASS (prior)**. |
| 04 | Prior statements stay unconfirmed until reviewed | CONTENT pending/unknown/different, reported-only payload and original retention: **LOCAL_PASS**; personal-review browser pending. Actual private-content application: **NOT_RUN** here. |
| 05 | A usable script is reachable and remains available | R1 copy, edit, reload; R2 twelve guides: **PASS (prior)**. |
| 06 | Changed information preserves originals and history | R1/R2 revision conflicts: **PASS (prior)**. CONTENT original-preserving corrections, guidance history and restoration: **LOCAL_PASS**, combined browser pending. |
| 07 | Employer permission, refusal and no reply remain distinct | R2 response saving, conflict and reported-only handling: **PASS (prior)**. GAPS verifies distinct follow-up instructions for permission/refusal/no reply, reported-only answers and no case mutation: **LOCAL_PASS**; new branch browser checks pending. |
| 08 | Missing receipt SMS does not imply no application | R2 filed-without-SMS fixture routes to receipt confirmation without mutation: **PASS (prior)**. |
| 09 | Investigation and employer disagreement do not create a decision | R2 investigation/disputed fixtures and zero writes when viewing guides: **PASS (prior)**. GAPS checks the employer-consent-independent application explanation and limits follow-up to actual requested materials: **LOCAL_PASS**. |
| 10 | Employer opposition is not automatic denial | R2 disputed-opinion routing and unrelated-record preservation: **PASS (prior)**. |
| 11 | A recommended examination is not a diagnosis or completed test | R2 medical-clarification routing and immutable case input: **PASS (prior)**. GAPS verifies an examination reply routes to clarification without a diagnosis/completion record: **LOCAL_PASS**. |
| 12 | Treatment period and recognized inability-to-work days differ | CONTRACTS ledger/day separation and R2 protected-data fixture: **PASS (prior)**. MANAGEMENT estimates do not create decisions: browser pending. |
| 13 | Recommended reminders and institution/legal checks stay separate | CONTRACTS approved-end deadlines and R2 date/kind preservation: **PASS (prior)**. |
| 14 | A message alone cannot establish official periods or amounts | CONTRACTS rejects unsupported official state; R2 reported-only responses: **PASS (prior)**. GAPS verifies SMS-only guidance stays at decision-document review and creates no period, claim or payment: **LOCAL_PASS**. |
| 15 | Paid treatment costs remain separate from reimbursement decisions | R2 expense guide and CONTRACTS source-backed ledger: **PASS (prior)**. MANAGEMENT decision/deposit separation and explicit saving: browser pending. |
| 16 | Treatment ending does not guarantee a disability payment | R2 post-treatment review route and immutable input: **PASS (prior)**. GAPS verifies closure and assessment replies create no disability decision/claim/payment: **LOCAL_PASS**. |
| 17 | Still employed does not imply unemployment eligibility | R1/R2 working-state routing and reported-only state: **PASS (prior)**. MANAGEMENT estimate has no record/payment writes: browser pending. |
| 18 | Calendar tenure, verified paid days and simulation are distinct | CONTRACTS paid-day ambiguity, prior-benefit exclusion and calendar aggregation: **PASS (prior)**. MANAGEMENT separate results: browser pending. GAPS checks exact before/after verified-day, estimated-day and expired-day counts without eligibility confirmation: **LOCAL_PASS**. |
| 19 | Missing policy blocks calculation but leaves guidance usable | R1/R2 policy-independent guidance: **PASS (prior)**. MANAGEMENT absent/ambiguous/out-of-date basis: **LOCAL_PASS**, browser pending. |
| 20 | Disconnected Drive does not block guidance or falsely claim upload | R1 disconnected state and CONTRACTS connection guards: **PASS (prior)**. MATERIALS memo-only path and upload state: combined browser pending. |
| 21 | Transfer failure preserves originals and supports retry | CONTRACTS resumable/integrity/revision checks: **PASS (prior)**. MATERIALS partial failure, retry, cancellation and duplicate originals: **LOCAL_PASS**, browser pending. |
| 22 | Existing record kinds, history, attachments and ledger stay usable | Prior private contracts: **PASS (prior)**. MATERIALS retained specialist creation/cancel and MANAGEMENT additive ledger/replay: combined browser pending. |
| 23 | Copy control follows the card during page scrolling | R1 and BROWSER page-relative sticky-copy checks: **PASS (prior)**, current integration pending. Actual iPhone Safari/PWA: **NOT_RUN**. |
| 24 | Editing supports copy, cancel, history and concurrent changes | R1/R2 copy/cancel/conflict: **PASS (prior)**. CONTENT edit/archive/restore/history and MATERIALS review/error recovery: **LOCAL_PASS**, browser pending. |
| 25 | Original PWA functionality and module boundaries remain intact | Previous required product regression: **PASS (prior)**. Current exact-head full regression: **CI_PENDING**. |

## Separate acceptance gates

- **Current software:** local assertions pass; pending browser and required-CI results must be recorded before acceptance.
- **Synthetic browser and local D1:** current integration pending; provider fixtures do not establish live provider acceptance.
- **Real private content:** no original material or private draft is reproduced by this document. Reviewing/preparing private content does not mean it was applied to production.
- **Real iPhone:** layout, clipboard, keyboard, safe-area and persistent-login acceptance are **NOT_RUN** for this integration.
- **Production and owner visual review:** separate gates. This file authorizes no merge, deployment, production-data changes or repository visibility changes.

The existing generic OCR diagnostic policy remains unchanged; this UX work does not relabel its separate failures as successes.

General application guidance source: [Ministry of Employment and Labor announcement on removal of employer confirmation](https://www.moel.go.kr/news/enews/report/enewsView.do?news_seq=8995), checked 2026-10-28. The explanation does not establish a case decision.
