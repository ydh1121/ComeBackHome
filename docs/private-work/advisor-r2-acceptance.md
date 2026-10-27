# Advisor UX v0.8 — R2 design and situation guidance

This candidate follows the owner's R1 flow review. PR #107 is based on MAIN `37a244c1c0526de6f1182301b0e39a3cb694c8a5`; it is not a production deployment. R1 and the Drive OAuth fix are already on MAIN. The owner confirmed their real Drive connection before this work. No private case data, credentials or original documents are included here or in CI.

## Implemented scope

- A quieter advisor home with one primary action, useful secondary links, three main tabs, scoped light/dark styling and reduced-motion support. Existing theme tokens and SVG icons are reused; no UI dependency was added.
- Twelve situation guides: consultation, medical clarification, workplace adjustment, filing through a hospital, receipt confirmation, investigation/employer disagreement, decision review, treatment extension, treatment expenses, temporary disability benefit, unemployment, and post-treatment review.
- Each guide provides three steps, an editable/copyable generic script, two preparation items, and an explicit choice of the actual reply received. Viewing a guide or selecting a reply writes nothing. Saving, retrying, deferring and handling concurrent edits use the existing case ACL/revision API.
- Deterministic, versioned response records use the existing `content/reference` contract. Replies remain `reported`, with no official source IDs. They never update an institution's decision, payment or medical record. A changed underlying record revision invalidates an old recommendation basis without deleting history.
- The Today tab resets an open guide. Existing deep links and the advanced workspace remain available.

The advisor is an independent reader of existing case data. There are no calendar, OCR, map, ETA, push, authentication, worker, database schema, deployment or environment changes. No new provider or model is called.

## Verification and evidence

Commands: client and worker typechecks, production build, `node scripts/verify-private-work.mjs`, `node scripts/verify-private-advisor.mjs`, and the existing isolated Chromium/WebKit + D1 workflow. Advisor model coverage includes 25 R1 checks and 95 R2 checks; existing private contracts contain 237 checks.

Browser coverage includes all twelve guides, zero writes on view/selection, explicit reported-only saving, failure/retry, reload/resume, concurrent reply edits, deferral, one deterministic record per scenario, preservation of unrelated records, and returning from a guide to Today. R1 copy/edit/long-press/cancel/conflict and card-bounded sticky copy controls are retained. Responsive checks cover 375, 390, 768, 1024 and 1440px; screenshots cover mobile light/dark and desktop. Synthetic screenshots are captured after the entrance motion finishes. Browser evidence is not actual iPhone acceptance.

Initial source `43e415b64e638638e11c0a4bccab0417ee6fc07d` passed all 12 required product jobs in [40436751575](https://github.com/ydh1121/ComeBackHome/actions/runs/40436751575). Private run [40436751543](https://github.com/ydh1121/ComeBackHome/actions/runs/40436751543) failed in the second browser because its unrelated-record assertion included the exact A/C synthetic reply records that the test intentionally edits. The assertion now excludes only those two IDs; each is separately checked for uniqueness, the selected reply, `reported` certainty and empty official sources. All other records remain compared in full. The failure is preserved, not relabelled PASS. Final source CI and screenshot artifact IDs are recorded in PR #107 and the four durable project records after completion.

Generic OCR diagnostics retain their existing separate nonblocking policy; this work does not modify or relabel those failures.

## Guidance references and follow-up

Applied selected guidance from [Apple](https://github.com/VoltAgent/awesome-design-md/tree/main/design-md/apple), [Stripe](https://github.com/VoltAgent/awesome-design-md/tree/main/design-md/stripe), [baseline-ui](https://github.com/ibelick/ui-skills), [make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better), [better-layout](https://github.com/jakubkrehel/skills), [ux-writing-kr](https://github.com/WooeeKim/ux-writing-kr) and [Transitions](https://transitions.dev/library.html). Existing component, theme and storage contracts take priority over introducing a new stack. The CODE1 Git catalog and planning documents were read only.

R3's editable content library/private historical mapping and subsequent R4/R5 work remain separate stages; this is not all-v0.8 acceptance. No private historical claims were seeded. The owner explicitly deferred a full redesign of documents, notes and My management until the end of the project. Actual iPhone visual review and PR #107 merge/canonical deployment require the next owner review; this change does not apply them automatically.
