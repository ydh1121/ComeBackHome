# Phase 5AF — Local Semantic Header OCR Fallback

Status: IMPLEMENTED / PRIVATE RE-RUN REQUIRED / PRODUCTION OCR DISABLED

## Problem isolated by Phase 5AE

The latest four-image private QA batch confirms that compact half-hour recovery improved schedule yield, while one sample still fails closed.

The failing sample contains usable date and numeric evidence. The missing structural evidence is semantic: the primary sparse OCR pass retains one shift header but does not reliably retain the complementary shift header required by the date-block strategy.

## Design

The browser extractor keeps the existing general sparse pass and numeric sparse pass.

A third local semantic pass runs only when the general pass does not contain both start and end shift-header anchors.

Properties:

- same local Tesseract worker;
- same same-origin worker/core/lang assets;
- no external OCR service;
- no screenshot persistence;
- full-image AUTO segmentation, not fixed coordinates;
- only recognized shift-header aliases are allowed to supplement the primary evidence;
- person names, dates and numeric schedule values are not introduced by this fallback;
- overlapping already-known header aliases are deduplicated;
- parser review/fail-closed behavior is unchanged.

This is an extraction-quality fallback. It is not a new workplace-layout assumption.

## Verification

The OCR adapter regression test now covers:

- normal images with start+end headers: two passes only;
- missing semantic end header: exactly one supplemental semantic pass;
- supplemental header recovery;
- no duplicate overlapping header;
- numeric decimal pass still runs afterward;
- worker termination and existing privacy/runtime guards remain intact.

Next: re-run the same four private screenshots once on latest main. If the failing image still lacks a semantic header after this local fallback, keep parser inference unchanged and evaluate a more targeted local crop/segmentation strategy.
