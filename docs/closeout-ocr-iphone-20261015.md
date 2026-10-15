# PR #92 OCR and iPhone closeout — 2026-10-15

The product remains on the existing local Paddle → source-linked review → explicit approval → atomic D1 import path. No external OCR provider is selected. This closeout repairs reproduced software defects; it does not claim current private-image, native iPhone or production acceptance.

## Source and evidence

- Starting PR #92: `a71d069194b2d81084a668d063fee2168616c185`.
- Measured product source: `498f01336015196fa3e54c7d2638919a0b8476ea`, tree `3645bd6198b589d25d13c1e8bb6a5cd1113f9868`.
- [Actual v2 Paddle measurement](https://github.com/ydh1121/ComeBackHome/actions/runs/38694498930): Chromium and WebKit, both successful.
- [Required product regression](https://github.com/ydh1121/ComeBackHome/actions/runs/38694504447): 12 required jobs successful; one conditional oracle job skipped. The CI merge-ref tree equals the measured branch tree. This is not a MAIN merge.
- [Preserved generic diagnostic failures](https://github.com/ydh1121/ComeBackHome/actions/runs/38694504597): two failures; see the separate scope below.
- MAIN stays `8c83e04c2035bc2c6db2e9573eda70e99fdbb962`. PR #91 stays `4ed6183d216e0e5e2c74e841afd0bd5f5fbd7976`. Both PRs remain draft, open and unmerged.

Full independent scores: [baseline](../runtime-evidence/paddle-v2-baseline-20261015.json), [final measurement](../runtime-evidence/paddle-v2-final-20261015.json). Actual Chromium [regional OCR observations](../runtime-evidence/paddle-v2-raw-synthetic-20261015.jsonl) and [336 pre-review predictions](../runtime-evidence/paddle-v2-predictions-20261015.jsonl) are retained. These files contain only the already-published synthetic corpus, never private employee originals. The 1,209 region observations preserve image/row/day/physical-column/bounds and raw text for audit. WebKit's independent per-image/aggregate scores are retained separately in the final report.

The final evidence/gate commit changes no OCR algorithm after the measured source. Its own HEAD, required CI and quality-gate run are recorded in the PR and four durable records after completion.

## Actual local-model quality

Both browsers use the product `Weekly3ColumnScheduleImageRecognizer`, actual table analysis, Tesseract header recognition and pinned Korean PP-OCRv5 ONNX/WASM recognition. Names are not supplied to recognition (`knownPersonNames=[]`); the source filename is neutral. Ground truth is passed only to the independent scorer after predictions are produced. There are no manual corrections in the measured predictions.

| Independent field | Valid baseline | Final Chromium | Final WebKit |
| --- | ---: | ---: | ---: |
| Predicted / truth cells | 308/336 | 336/336 | 336/336 |
| Employee row, column, date, name | 308/336 | 336/336 | 336/336 |
| State | 285/336 | 336/336 | 336/336 |
| SHIFT start | 281/319 | 319/319 | 319/319 |
| SHIFT end | 291/319 | 319/319 | 319/319 |
| SHIFT break | 207/319 | 319/319 | 319/319 |
| Missing cells | 28 | 0 | 0 |
| Review required | all returned candidates | 336/336 | 336/336 |

Final weekday matching is also 336/336. There are no unmatched or duplicate predictions, unsafe auto-confirmations, nonshift→SHIFT or blank/unreadable→OFF classifications. BLANK is 9/9, explicit OFF_CANDIDATE 4/4 and actual UNREADABLE 4/4. Every state still requires review; the scorer's source classification is not an automatic schedule decision.

Chromium recognition latency: min 8,303 / max 11,781 / mean 10,110 ms, total 121,321 ms. WebKit: min 9,061 / max 12,893 / mean 11,051 ms, total 132,617 ms. External inference, private images and D1 writes during quality measurement are all zero. Local model computation has no external API token/Neuron consumption; historical external account balances remain unmeasured.

Immutable corpus SHA-256: `6ef21653700982396adf75d32e0fd892c939fcfc3453a4d0ca389bb2ba08965a`.
Unchanged independent scorer SHA-256: `c673e7337cb65896057c543e07a599ed55050f221f74bcb1d6ded9fc94485004`.
Pinned model SHA-256: `92f0b7785e64fc9090106a241cf4c1eb97472824558272751b88a2a4476d3a08`.

Saved predictions replay through that original scorer to exactly the recorded aggregates. `paddle-v2-quality-gate.mjs` applies the existing 98% field target, exact structural completeness and zero unsafe cases. Negative controls reject degraded scores, missing cells, absent review and runtime failures. Earlier WASM middleware runtime failures are not accuracy results. The harness now resolves the actual same-origin runtime including import query strings and fails invalid execution.

These twelve images were used to diagnose the fixes. They are a regression set, not a blind holdout. Current private-original accuracy is **UNVERIFIED**; the historical five-image PASS must not be reused as a final score. No current private pixels were available in this execution. The older Option B strict automatic-state score remains 0.857142857, because OFF remains a review candidate; its existing conditional-recognition acceptance and thresholds are unchanged.

## Reproduced defects and fixes

| Boundary | Observed cause | Product correction |
| --- | --- | --- |
| Table structure / low resolution | Pale grid lost vertical strokes; B had no accepted 22-band geometry and 28 missing cells | Optional long-run faint-stroke detection; accept only observed adjacent 22-band weekly geometry. No invented boundaries; generic default unchanged |
| Day's three physical fields | Pixel-density EMPTY heuristic skipped thin clock/break glyphs such as `1` | If any field of a physical day is occupied, recognize each of its three fields independently. An entirely empty trio remains a blank review candidate |
| Employee identity | Duplicate normalized OCR names could collapse different physical rows | Preserve separate row-qualified identities and require manual person resolution; never auto-match ambiguous names |
| Time / break normalization | Early clock hours and exact fractional breaks were rejected by inappropriate generic rules | Apply bounded parsing to typed physical fields, exact supported fractions/minutes; reject equal start/end and break ≥ shift duration |
| OFF / blank / unreadable | Review-only OFF candidates obscured whether source was empty or explicitly OFF | Carry `sourceCellKind` through review: SHIFT, BLANK, EXPLICIT_OFF, UNREADABLE. Unknown content is not blank; conflicting OFF text is not accepted |
| Confidence / approval | Candidate state must not imply approval | Retain review-required state and source crops; corrections revoke approval; no automatic D1 write |

The fixes use physical evidence and general field rules, not image IDs, truth values, expected employee names or per-example answers. Product logs no longer print raw OCR text. Synthetic diagnostics explicitly retain raw observations for reproducibility.

## Review, D1 and full-chain regression

Actual Chromium/WebKit tests exercise React image selection, actual Paddle, source/date/OFF review, explicit simulated user approval, the loopback Wrangler API and isolated local D1, then reload. Each browser commits 14 rows (12 WORK, two explicitly approved OFF); unapproved attempts are blocked, replay IDs are stable and break values persist. Unknown person, invalid date/clock, duplicate person-date, invalid break and injected SQL batch failure all reject or roll back atomically. The separate generated-image suite preserves its 168-row round trip and replay checks.

F01–F08, XLSX, people/schedules, preferred route, ETA, notification rules, presence receipts, duplicate-event handling and local Outbox remain covered by the 12 required jobs, including Phase A–G. The full-chain test records zero pre-approval writes, actual D1 persistence, cancellation/retry and the F09 guide link in both browsers. Existing provider, live Push/Kakao and production mutations remain zero. Test approval is not the owner's acceptance of a real schedule.

## Historical external candidates: not adopted

No external OCR call was made during this closeout. Existing keys and licence approval are preserved; no additional key registration is needed.

| Candidate | Retained actual result | Decision |
| --- | --- | --- |
| Cloudflare Workers AI / Gemma4 | 12 images; eight missing cells; name 76.7857%, start 82.4451%, end 78.0564%, break 50.4702%; one BLANK→SHIFT. Later schema variant timed out | Quality insufficient; not selected |
| Gemini 3.8 Flash | One 21-cell image succeeded; HTTP 503 and timeout prevented the 336-cell evaluation | Full accuracy unknown; not selected |
| OCR.space Engine 3 | Name 329/336; state 277/336; start/end each 273/319; break 272/319; 63 UNREADABLE | Quality insufficient; not selected |

Cloudflare's preserved conservative estimate is 815.160775 known Neurons plus 4,190.5408 unknown-request reservation, not a billed balance. Gemini returned 4,242 known tokens; four failed-request usages remain unknown. OCR.space recorded 49 historical HTTP successes; billed/remaining free allowance is unmeasured. HTTP success is not quality acceptance.

OCR.space's 63 UNREADABLE outputs can be decomposed from retained per-image scores:

| Source case | True SHIFT | True BLANK | True OFF | True UNREADABLE | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| C_small_font | 7 | 0 | 0 | 0 | 7 |
| I_blank_cells | 26 | 9 | 0 | 0 | 35 |
| J_off_unreadable | 13 | 0 | 4 | 4 | 21 |
| Total | 46 | 9 | 4 | 4 | 63 |

There are also seven name mismatches and one additional break mismatch among the retained small-font scores. Raw responses and per-cell predictions were not retained for that historical run. Whether each failure was OCR omission, bad crop, name mismatch or time glyph error is **NOT_RECOVERABLE_FROM_RETAINED_EVIDENCE**; no raw text was reconstructed from truth. Provider `review_required` was unsupported/null; its scorer's 336 unsafe-approval flags remain recorded and do not represent actual product writes.

## Generic OCR FAIL2 remains a real limitation

[Machine-readable diagnosis](../runtime-evidence/generic-ocr-closeout-20261015.json) preserves both failures. The 4–6-day Tesseract pilot fails its objective thresholds. Across the separate 5–6-day matrix (12 browser/image cases, 228 cells), Paddle has two date-anchor failures, 121 correct cells and two diagnostic wrong-auto decisions. Its raw field recognition is 396/404 with oracle crops versus 301/404 with detected crops. This supports a crop/row/date-allocation bottleneck, with additional anchor recognition failures; oracle boxes are not a product capability. Other tested engines/hybrids also fail. Diagnostic wrong-auto does not mean D1 was written.

No threshold was lowered or failure converted to success. Under the existing `D-CBH-20261009-OCR-GATE-C-DISPOSITION-001`, this generic research path is nonblocking for the current workplace 7×3 scope and is not a product fallback. General 4–6-day automatic recognition remains unsupported work, not a completed feature.

## F09 receiver handoff

The executable [receiver reference](../src/features/alarms/clock-receiver.ts), [contract](iphone-clock-contract.md), and complete Korean [30-step Shortcuts setup guide](../public/guides/iphone-clock-setup.html) are ready. AlarmPage links the guide and displays the scope to pin. The guide supplies action names, inputs, conditions, loops, local `On My iPhone/ComeBackHome/clock-ledger.json`, operation review, pending journals and interruption recovery.

The reference rejects invalid/expired `cbh-clock/v1`, mismatched installation/person scope, duplicate labels, corrupt/missing ledgers and ambiguous ownership. Only exact ledger receipt + label + time + nonrepeating alarm matches are eligible. Prefix matches alone are never adopted. Personal alarms remain untouched. It covers start −90 minutes, end +30 minutes, OFF, midnight/year/overnight, edits, repeated synchronization, disabled owned alarms and interrupted creation. Native operations are explicitly Turn On / create / delete specified owned objects; no bulk delete or implicit toggle.

Official Apple documentation supports URL text handoff and Find/Delete Alarm actions. The owner's exact iOS property availability, Files permissions, action translations, native execution and ringing remain unverified. Stop if a required alarm property is unavailable. There is no Apple-signed installable shortcut from this environment; JSON is not presented as one. Specific alarm sounds and atomic Clock+Files/concurrent synchronization are not promised. Run one synchronization at a time. No real iPhone installation or alarm operation occurred.

## Separate acceptance states and owner handoff

| Scope | Status |
| --- | --- |
| F01–F08 software; F09 web/data/reference/complete recipe | PASS |
| Full nonimage / Phase A–G / XLSX regression | PASS |
| Current 7×3 local OCR implementation, immutable synthetic accuracy, review/isolated D1 | PASS within stated evidence |
| Current private-original / independent real-world OCR quality | UNVERIFIED; owner-local acceptance needed |
| Generic 4–6-day automatic OCR | FAIL2 preserved; outside selected product scope |
| F09 installed native receiver and actual alarms | PARTIAL / device acceptance needed |
| External OCR adopted or accepted | None |
| Production | HOLD |

`OCR_SYNTHETIC_V2_ACCEPTED` and `FULL_NONIMAGE_REGRESSION_PASS` are evidenced. Unqualified `OCR_SOFTWARE_ACCEPTED` and `FULL_PRODUCT_SOFTWARE_ACCEPTED` remain PARTIAL until current real-image acceptance is established; `F01_F09_SOFTWARE_ACCEPTED` covers web/reference/recipe only and must not imply native acceptance. No reproduced defect remains in the selected 7×3 synthetic set, but that is not a general accuracy guarantee.

The remaining owner actions are: provide or select current private originals for local-only review and separately score them; approve and perform the guide's iPhone installation/test matrix with personal-alarm preservation; later authorize any exact production release action. No production migration 0009/0010, MAIN/PR #91 merge, deployment, new Worker/Pages, paid API, private-image external transfer, live Push/Kakao, native alarm mutation or commute trial is authorized by this closeout. `RELEASE_HOLD_UNTIL_OWNER_APPROVAL` continues.
