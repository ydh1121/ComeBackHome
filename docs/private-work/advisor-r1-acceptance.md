# Advisor UX v0.8 — R1 review candidate

R1 is the first-screen review gate, not acceptance of all v0.8 scenarios. It follows the completed Drive software fix in PR #105 (`ce217fef`); actual Google connection is still unverified. MAIN merge and production deployment require separate owner approval. No real case files or private planning seed are used in this candidate or CI.

## Scope and preservation

- `/injury` opens an advisor home with Today / Progress / My materials, one useful action and a copyable generic hospital question. No record form or policy setup is required.
- Three optional questions accept unknown or later. Unknown is `null`, not a negative answer. Choices persist with revision checks; confirmation remains user-reported, never an institutional decision.
- The existing record workspace remains under My management. All six old `section` URLs still open their original workspace. Existing records, documents, payment events, policies and revisions are retained.
- The hospital script can be copied, edited, cancelled and saved, with revision conflict handling. Page-scrolling copy controls stay inside the text card. The default template contains no personal history.
- The new view reads only `CaseData`. It does not use schedule repositories, alter authentication, change database migrations, or introduce an AI/provider service.

## Persistence adapter

R1 reuses the existing `content` kind and server case ACL/revision API. A deterministic case-scoped profile record stores a validated version-1 questionnaire body, marked `reference`, `reported`, and with no official source IDs. One record is updated rather than creating a record per answer. The profile is hidden from generic document-card lists; normal answers are shown in the advisor. Existing unrelated records are never rewritten. The generic hospital script is a separate editable `content/message` record created only when the user explicitly saves an edit. No D1 migration or seed import is needed.

This is deliberately a limited adapter. The full content library and private 63-record mapping belong to R3. Existing policy/import/export management is preserved in the advanced workspace; the complete v0.8 admin-tool reorganization is not accepted in R1.

## Evidence and remaining gates

Targeted commands: `node scripts/verify-private-advisor.mjs`, client/worker typechecks, and `scripts/private-work/verify-advisor-r1-ui.mjs` called by the existing isolated Chromium/WebKit + D1 workflow. Screenshots are generated at 375/390px; broader responsive checks retain 768/1024/1440. Clipboard assertions use a synthetic browser clipboard, not an iPhone clipboard claim.

Current candidate: local model checks and types passed; exact-head browser and full regression are pending. Screenshots must be inspected and presented to the owner before R1 visual acceptance. No R2–R5 implementation should be silently combined with this review.

| QA | R1 coverage | Status before CI |
|---|---|---|
| 01 Empty case gets an action and script | Empty home, no record form prerequisite | Pending browser |
| 02 Three primary menus | Advisor heading and three navigation buttons | Pending browser |
| 03 At most three optional questions | Unknown/later, persistence and retry | Pending browser |
| 04 Historical statements remain unconfirmed | No private history is seeded in R1 | R3 not run |
| 05 Script within 2–3 taps | Home → action → copy | Pending browser |
| 06 Changed facts preserve history | Profile/script revision API; unrelated records preserved | Pending browser |
| 07 Employer reply branches | Full situation rules | R2 not run |
| 08 Receipt without SMS | Full situation rules | R2 not run |
| 09 Investigation | Full situation rules | R2 not run |
| 10 Employer disagreement | Full situation rules | R2 not run |
| 11 MRI recommendation is not diagnosis | No MRI/personal claim auto-populated | R2 not run |
| 12 Treatment and lost-work days differ | Existing calculation contracts retained | Full regression pending |
| 13 Extension deadlines | Existing deadline contracts retained | R2 UI not run |
| 14 Approval SMS is not decision evidence | Profile is reported-only | R2 document flow not run |
| 15 Out-of-pocket costs | Existing ledger retained | R5 not run |
| 16 End of treatment is not disability approval | No automatic decision in R1 | R2 not run |
| 17 Still employed is not unemployment eligibility | Separate track, no eligibility calculation | R2 not run |
| 18 Paid days versus calendar tenure | Existing calculators retained | R5 not run |
| 19 No policy still permits guidance | Generic home and scripts are policy-independent | Pending browser |
| 20 Drive disconnected | Home remains usable, no file-saved claim | Pending browser |
| 21 Transfer failure recovery | Existing document tests retained | Full regression pending |
| 22 Existing 19 kinds and history | Advanced workspace preserved | Full regression pending |
| 23 Long page-scrolling copy | Card-bounded sticky toolbar | Pending browser; real iPhone not run |
| 24 Edit/copy/cancel/conflict | Script editor and original revision preservation | Pending browser |
| 25 Original PWA regression | Existing 12-job required suite retained | Pending exact-head CI |
