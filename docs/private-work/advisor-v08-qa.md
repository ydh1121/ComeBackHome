# Advisor v0.8 acceptance map

This is a test map, not a whole-project acceptance declaration. The accepted PR108 baseline is `4f91d85eba42fe89b90fc270ce9849b696e8d34c`: **535 local contract/model checks**, client/worker typechecks, [full product CI 12/12](https://github.com/ydh1121/ComeBackHome/actions/runs/40557273432), and [private module CI 3/3](https://github.com/ydh1121/ComeBackHome/actions/runs/40557273261). Its Chromium/WebKit and isolated-D1 flows passed. Final synthetic evidence contains 86 screenshots; representative mobile/desktop/light/dark screens were visually inspected.

The table below records that baseline coverage. `BASELINE_PASS` does not accept subsequent changes automatically. The current closeout adds v2 specialist mapping, reviewed Drive organization, authenticated draft receipt and MAIN private-CI gating. Those changes are **IMPLEMENTATION_IN_PROGRESS / EXACT_HEAD_VERIFICATION_PENDING** until their own results are recorded. A previous passing PR or deployment is not evidence for the new source.

`NOT_RUN` identifies an actual private-source, external-provider or physical-device check without accepted evidence. Synthetic fixtures never substitute for those checks.

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
| 01 | Empty case immediately offers an action and usable wording | R1 empty home, no seed prerequisite: **BASELINE_PASS**. CONTENT fallback/replay: **BASELINE_PASS**, baseline combined browser PASS. |
| 02 | Three primary destinations and one leading action | R1 home/navigation: **BASELINE_PASS**; baseline integrated BROWSER PASS. |
| 03 | Optional questions, unknown and later are valid paths | R1 profile model and browser reload/retry/defer: **BASELINE_PASS**. |
| 04 | Prior statements stay unconfirmed until reviewed | CONTENT pending/unknown/different, reported-only payload and original retention: **BASELINE_PASS**; baseline personal-review browser PASS. Actual private-content application: **NOT_RUN** here. |
| 05 | A usable script is reachable and remains available | R1 copy, edit, reload; R2 twelve guides: **BASELINE_PASS**. |
| 06 | Changed information preserves originals and history | R1/R2 revision conflicts: **BASELINE_PASS**. CONTENT original-preserving corrections, guidance history and restoration: **BASELINE_PASS**, baseline combined browser PASS. |
| 07 | Employer permission, refusal and no reply remain distinct | R2 response saving, conflict and reported-only handling: **BASELINE_PASS**. GAPS verifies distinct follow-up instructions for permission/refusal/no reply, reported-only answers and no case mutation: **BASELINE_PASS**; baseline browser checks PASS. |
| 08 | Missing receipt SMS does not imply no application | R2 filed-without-SMS fixture routes to receipt confirmation without mutation: **BASELINE_PASS**. |
| 09 | Investigation and employer disagreement do not create a decision | R2 investigation/disputed fixtures and zero writes when viewing guides: **BASELINE_PASS**. GAPS checks the employer-consent-independent application explanation and limits follow-up to actual requested materials: **BASELINE_PASS**. |
| 10 | Employer opposition is not automatic denial | R2 disputed-opinion routing and unrelated-record preservation: **BASELINE_PASS**. |
| 11 | A recommended examination is not a diagnosis or completed test | R2 medical-clarification routing and immutable case input: **BASELINE_PASS**. GAPS verifies an examination reply routes to clarification without a diagnosis/completion record: **BASELINE_PASS**. |
| 12 | Treatment period and recognized inability-to-work days differ | CONTRACTS ledger/day separation and R2 protected-data fixture: **BASELINE_PASS**. MANAGEMENT estimates do not create decisions: baseline browser PASS. |
| 13 | Recommended reminders and institution/legal checks stay separate | CONTRACTS approved-end deadlines and R2 date/kind preservation: **BASELINE_PASS**. |
| 14 | A message alone cannot establish official periods or amounts | CONTRACTS rejects unsupported official state; R2 reported-only responses: **BASELINE_PASS**. GAPS verifies SMS-only guidance stays at decision-document review and creates no period, claim or payment: **BASELINE_PASS**. |
| 15 | Paid treatment costs remain separate from reimbursement decisions | R2 expense guide and CONTRACTS source-backed ledger: **BASELINE_PASS**. MANAGEMENT decision/deposit separation and explicit saving: baseline browser PASS. |
| 16 | Treatment ending does not guarantee a disability payment | R2 post-treatment review route and immutable input: **BASELINE_PASS**. GAPS verifies closure and assessment replies create no disability decision/claim/payment: **BASELINE_PASS**. |
| 17 | Still employed does not imply unemployment eligibility | R1/R2 working-state routing and reported-only state: **BASELINE_PASS**. MANAGEMENT estimate has no record/payment writes: baseline browser PASS. |
| 18 | Calendar tenure, verified paid days and simulation are distinct | CONTRACTS paid-day ambiguity, prior-benefit exclusion and calendar aggregation: **BASELINE_PASS**. MANAGEMENT separate results: baseline browser PASS. GAPS checks exact before/after verified-day, estimated-day and expired-day counts without eligibility confirmation: **BASELINE_PASS**. |
| 19 | Missing policy blocks calculation but leaves guidance usable | R1/R2 policy-independent guidance: **BASELINE_PASS**. MANAGEMENT absent/ambiguous/out-of-date basis: **BASELINE_PASS**, baseline browser PASS. |
| 20 | Disconnected Drive does not block guidance or falsely claim upload | R1 disconnected state and CONTRACTS connection guards: **BASELINE_PASS**. MATERIALS memo-only path and upload state: baseline combined browser PASS. |
| 21 | Transfer failure preserves originals and supports retry | CONTRACTS resumable/integrity/revision checks: **BASELINE_PASS**. MATERIALS partial failure, retry, cancellation and duplicate originals: **BASELINE_PASS**, baseline browser PASS. |
| 22 | Existing record kinds, history, attachments and ledger stay usable | Prior private contracts: **BASELINE_PASS**. MATERIALS retained specialist creation/cancel and MANAGEMENT additive ledger/replay: baseline combined browser PASS. |
| 23 | Copy control follows the card during page scrolling | R1 and BROWSER page-relative sticky-copy checks: **BASELINE_PASS**, baseline integration PASS. Actual iPhone Safari/PWA: **NOT_RUN**. |
| 24 | Editing supports copy, cancel, history and concurrent changes | R1/R2 copy/cancel/conflict: **BASELINE_PASS**. CONTENT edit/archive/restore/history and MATERIALS review/error recovery: **BASELINE_PASS**, baseline browser PASS. |
| 25 | Original PWA functionality and module boundaries remain intact | Previous required product regression: **BASELINE_PASS**. Baseline exact-head full regression: **BASELINE_PASS**; subsequent closeout source requires fresh CI. |

## Closeout delta — independent verification required

| New behavior | Required evidence | Current status |
|---|---|---|
| v2 specialist records | All 19 existing kinds, v1 compatibility, held official fields, strict source/link validation and normalized replay | IMPLEMENTED · dedicated checks included in required CI |
| JSON file import | Valid UTF-8 file, malformed/oversized file, invalidated old preview, readable normalized destination, cancel and explicit save | IMPLEMENTED · dedicated checks included in required CI |
| Authenticated draft receipt | Source-scoped grant, own-session/consent checks, expiry/revocation, stale sources, identical/different retry, no token in normal lists/history/export | IMPLEMENTED · dedicated checks included in required CI |
| Reviewed Drive organization | Explicit approval, allowed root/category, integrity/revision/ACL changes, remote ambiguity, post-move DB failure, retry and partial results | IMPLEMENTED · dedicated checks included in required CI |
| Release gate | Exact-MAIN product 12 and private 3 successes; missing/failing/stale/PR-only results blocked before deployment request | IMPLEMENTED · dedicated checks included in required CI |

The implementation paths and API limits are documented in [materials closeout](materials-batch-acceptance.md) and [analysis handoff](analysis-handoff.md). Final source SHA, test counts, workflow URLs and screenshot evidence belong to the PR108 release record and durable CURRENT SNAPSHOT; baseline success alone cannot satisfy those gates.

## Separate acceptance gates

- **Baseline software:** accepted results above remain preserved.
- **Current closeout software:** client/worker types and dedicated local/model checks pass. Exact-source browser, required CI and canonical health are release gates; their run IDs and outcome are recorded in PR108 and CURRENT SNAPSHOT.
- **Synthetic browser and local D1:** the baseline passed; new-delta evidence is separate. Provider fixtures do not establish live provider acceptance.
- **Real private content:** no original material or private draft is reproduced by this document. Reviewing/preparing private content does not mean it was applied to production.
- **Real iPhone:** layout, clipboard, keyboard, safe-area and persistent-login acceptance are **NOT_RUN** for this integration.
- **Production and owner visual review:** separate gates. The owner authorized the remaining implementation and canonical release on 2026-10-28. This does not establish a completed deployment, private-data application or physical-device acceptance, and does not authorize changing repository visibility.

The existing generic OCR diagnostic policy remains unchanged; this UX work does not relabel its separate failures as successes.

General application guidance source: [Ministry of Employment and Labor announcement on removal of employer confirmation](https://www.moel.go.kr/news/enews/report/enewsView.do?news_seq=8995), checked 2026-10-28. The explanation does not establish a case decision.
