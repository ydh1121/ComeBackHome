# ComeBackHome Private OCR Evaluation Harness — Phase 5Z

Status: LOCAL-ONLY HARNESS IMPLEMENTED / PRIVATE SAMPLE QUALITY NOT YET ACCEPTED / NO PRODUCTION ROUTE

Phase 5Z provides a separate browser tool for evaluating real schedule screenshots without adding OCR to the production application.

## Start

Install dependencies, then run:

npm run ocr:eval

The launcher:

- creates a temporary OCR public directory;
- stages the pinned same-origin Tesseract runtime;
- starts Vite on 127.0.0.1:4191 only;
- serves tools/ocr-eval as a separate root;
- removes temporary OCR runtime assets when the process stops.

Open:

http://127.0.0.1:4191/

## What the harness does

The user may select one or multiple image files at once.

For every selected image, the page runs:

1. BrowserScheduleOcrPreprocessor
2. TesseractScheduleImageTextExtractor
3. parseScheduleImageLayout

It displays:

- source file metadata;
- image dimensions;
- OCR token count;
- average OCR confidence;
- OCR timing;
- parser timing;
- adaptive parser result or fail-closed error;
- every OCR token with bbox/confidence.

The harness does not commit or save schedules.

## Privacy boundary

The selected source screenshot is passed directly from the browser file input to the local extractor.

The harness source contains no:

- fetch upload call;
- XMLHttpRequest;
- FormData upload;
- sendBeacon;
- localStorage/sessionStorage;
- IndexedDB source-image persistence.

Tesseract.js itself may cache language traineddata according to its normal runtime behavior. This is static OCR model data, not the selected workplace screenshot.

The source screenshot is not written to disk by the harness and is not sent to an external OCR API.

## Network boundary

The evaluation server binds only to:

127.0.0.1:4191

OCR worker/core/language assets are served from that same local origin.

No production route imports tools/ocr-eval.

## Parser boundary

A parser failure is reported as REVIEW_REQUIRED/FAILED_CLOSED.

The harness must never invent a schedule from low-confidence OCR.

Even a successful parse remains review-only and does not bypass the existing person/structure/KEEP-or-NEW workflow.

## Sample-layout rule

The current workplace screenshots remain samples only.

The harness exists specifically to test whether OCR evidence and the adaptive strategy system generalize when:

- a person's row changes;
- the employer changes;
- columns move;
- dates move;
- labels differ;
- image resolution/crop changes.

New recurring layouts should become explicit parser strategies, not hard-coded coordinate patches.

## Verification

npm run verify:ocr-eval-harness

The CI verifier:

- statically rejects source-image persistence/upload primitives in the harness page;
- verifies loopback-only binding;
- verifies the project OCR extractor and adaptive parser are used;
- verifies production composition does not import the harness;
- verifies the normal production build is unchanged;
- stages same-origin runtime assets into a temporary public directory;
- performs a standalone Vite build of the harness;
- proves worker and Korean/English traineddata assets are present in the harness build;
- deletes all temporary files.

## Acceptance still pending

Phase 5Z code readiness is not equivalent to OCR quality acceptance.

Actual acceptance requires the user to run the local harness against private representative screenshots and inspect:

- Korean names/labels;
- date fidelity;
- decimal punctuation;
- bbox placement;
- adaptive parser output;
- latency/memory on target devices.

Those screenshots must not be committed to Git.


## One-step QA handoff

The harness aggregates every selected image into one in-memory QA bundle:

- schema = comebackhome-private-ocr-eval/v2
- per-file source metadata
- OCR/image summary
- parser result or fail-closed error
- full OCR token evidence

After the batch finishes, the user has two equivalent handoff options:

- 전체 QA 결과 복사: copies the complete JSON bundle once so it can be pasted to ChatGPT in one action;
- 결과 JSON 저장: downloads one derived-evidence JSON file that can be attached once.

The JSON export contains OCR-derived text/geometry and may contain employee names or work hours. Export is therefore user-triggered only. It does not contain the source image bytes and does not change sourceImagePersistence=0.
