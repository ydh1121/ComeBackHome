# Advisor UX v0.8 — R1 review candidate

R1 is the first-screen review gate, not acceptance of all v0.8 scenarios. It follows the completed Drive software fix in PR #105 (`ce217fef`); actual Google connection is still unverified. MAIN merge and production deployment require separate owner approval. No real case files or private planning seed are used in this candidate or CI.

## Scope and preservation

- `/injury` opens an advisor home with Today / Progress / My materials, one useful action and a copyable generic hospital question. No record form or policy setup is required.
- Three optional questions accept unknown or later. Unknown is `null`, not a negative answer. Deferring or knowing only an employment answer keeps the useful hospital action; only a reported filed/investigating/decision stage switches to progress review. Choices persist with revision checks; confirmation remains user-reported, never an institutional decision.
- The existing record workspace remains under My management. All six old `section` URLs still open their original workspace. Existing records, documents, payment events, policies and revisions are retained.
- The hospital script can be copied, edited, cancelled and saved, with revision conflict handling. Page-scrolling copy controls stay inside the text card. The default template contains no personal history.
- The new view reads only `CaseData`. It does not use schedule repositories, alter authentication, change database migrations, or introduce an AI/provider service.

## Persistence adapter

R1 reuses the existing `content` kind and server case ACL/revision API. A deterministic case-scoped profile record stores a validated version-1 questionnaire body, marked `reference`, `reported`, and with no official source IDs. One record is updated rather than creating a record per answer. The profile is hidden from generic document-card lists; normal answers are shown in the advisor. Existing unrelated records are never rewritten. The generic hospital script is a separate editable `content/message` record created only when the user explicitly saves an edit. No D1 migration or seed import is needed.

This is deliberately a limited adapter. The full content library and private 63-record mapping belong to R3. Existing policy/import/export management is preserved in the advanced workspace; the complete v0.8 admin-tool reorganization is not accepted in R1.

## Evidence and remaining gates

Targeted commands: `node scripts/verify-private-advisor.mjs`, client/worker typechecks, and `scripts/private-work/verify-advisor-r1-ui.mjs` called by the existing isolated Chromium/WebKit + D1 workflow. Screenshots are generated at 375/390px; broader responsive checks retain 768/1024/1440. Clipboard assertions use a synthetic browser clipboard, not an iPhone clipboard claim.

Evidence recorded on 2026-10-27 (Asia/Seoul). This evidence-only documentation change does not modify the tested application, tests or workflows. Verified software source: `2b2e29ca3f9bca534cbdf0ee2aee759250bb0561`. Private workflow [40339863377](https://github.com/ydh1121/ComeBackHome/actions/runs/40339863377) passed all 3 jobs: Windows password interoperability, private contracts/native workerd, and isolated Chromium/WebKit + D1. Model checks: 25; existing private contracts: 237. The browser run includes copy during editing, cancel, long press, page-scrolling copy controls, concurrent script edits, reload/resume, all-unknown answers, a failed-save retry, deferral, existing records, and Drive recovery using a synthetic provider.

Full product workflow: [40339863480](https://github.com/ydh1121/ComeBackHome/actions/runs/40339863480) passed all 12 required jobs on that software source (the PR-81-only diagnostic job is intentionally skipped). The stacked PR base is explicitly included in the existing workflow so the required real-browser Paddle gate runs before main merge; no check criterion was lowered. Generic OCR diagnostics retain their separate nonblocking policy: both existing failures remain FAIL in run [40338609754](https://github.com/ydh1121/ComeBackHome/actions/runs/40338609754); they are not represented as PASS.

Actual 375/390px mobile and 1440px desktop captures were inspected. The initial wrapped refresh button was fixed. Screenshot artifact [12658823132](https://github.com/ydh1121/ComeBackHome/actions/runs/40339863377/artifacts/12658823132) has SHA-256 `c3bdfac0e697ad604d084925a0ab25720d5ce0dce9728d4867b2ae0faac2be11`; all content is synthetic. Browser layout checks also cover 768/1024px. WebKit is browser evidence, not actual iPhone acceptance. Clipboard tests use a synthetic clipboard. The member's real Google connection and original documents remain unverified.

The initial browser failures remain recorded: run 40336176822 could not resolve the editable script's exact label; a separate associated label fixes it without weakening the locator. Run 40338108440 passed Chromium R1 but later lost window-scoped login KDF observations after R1's real reload; those unchanged 600,000-iteration assertions now run before the reload. Final private CI passes both engines and the original auth checks.

R1 software is ready for owner visual review. R1 visual acceptance is **PENDING** and all-v0.8 acceptance is **NOT ACHIEVED**. R2–R5 remain separate work after that review. Neither PR #105 nor #106 is merged or deployed; the latest owner instruction requires separate approval.

| QA | Verified coverage / limit | Status |
|---|---|---|
| 01 Empty case gets an action and script | Empty home, no record form prerequisite, both browsers | PASS R1 |
| 02 Three primary menus | Today / Progress / My materials, both browsers | PASS R1 |
| 03 At most three optional questions | Unknown/later, reload/resume, retry and one case-scoped record | PASS R1 |
| 04 Historical statements remain unconfirmed | No private history seeded; full history mapping belongs to R3 | NOT RUN R3 |
| 05 Script within 2–3 taps | Home → action → copy, both browsers | PASS R1 |
| 06 Changed facts preserve history | Script conflict and revisions pass; full historical-fact reopening is later | PARTIAL |
| 07 Employer reply branches | Full situation rules | NOT RUN R2 |
| 08 Receipt without SMS | Full situation rules | NOT RUN R2 |
| 09 Investigation | Full situation rules | NOT RUN R2 |
| 10 Employer disagreement | Full situation rules | NOT RUN R2 |
| 11 MRI recommendation is not diagnosis | No MRI/personal claim auto-populated; full branch is later | NOT RUN R2 |
| 12 Treatment and lost-work days differ | Existing domain contracts preserved; advisor detail is later | PARTIAL |
| 13 Extension deadlines | Existing deadline contracts preserved; advisor detail is later | PARTIAL |
| 14 Approval SMS is not decision evidence | Profile remains reported-only; document branch is later | PARTIAL |
| 15 Out-of-pocket costs | Existing ledger preserved; redesigned flow is later | NOT RUN R5 |
| 16 End of treatment is not disability approval | No automatic decision in R1; full branch is later | NOT RUN R2 |
| 17 Still employed is not unemployment eligibility | Separate progress track; no eligibility inferred from answers | PARTIAL |
| 18 Paid days versus calendar tenure | Existing calculators preserved; redesigned flow is later | NOT RUN R5 |
| 19 No policy still permits guidance | Generic home and scripts are policy-independent | PASS R1 |
| 20 Drive disconnected | Guidance remains usable; no original-file saved claim | PASS R1 |
| 21 Transfer failure recovery | Existing synthetic-provider/local-D1 recovery tests | PASS software; real Drive unverified |
| 22 Existing 19 kinds and history | Private contracts and advanced-workspace regression retained | PASS software |
| 23 Long page-scrolling copy | Card-bounded sticky toolbar in both browsers | PASS browser; real iPhone unverified |
| 24 Edit/copy/cancel/conflict | Explicit edit and long press; draft and history preserved | PASS R1 |
| 25 Original PWA regression | Required full product workflow | PASS: 12 required jobs |
