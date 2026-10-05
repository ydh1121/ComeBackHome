# ComeBackHome OCR Adapter Evaluation — Phase 5W

Status: TESSERACT.JS PROTOTYPE SELECTED / PRODUCTION OCR STILL DISABLED

This evaluation follows the project OCR skill and the Harness local-first/privacy rule.

The user's four workplace screenshots were used only as local/private evaluation inputs. They are not committed to GitHub.

## Candidate 1 — Tesseract.js 7.0.0

Repository: naptha/tesseract.js

License: Apache-2.0.

Fit:
- runs in a browser through WebWorker + WebAssembly;
- accepts File/Blob image inputs;
- blocks output can provide word-level bounding boxes and confidence;
- worker/core/language asset paths are configurable;
- Korean traineddata exists in the official tesseract-ocr tessdata_fast and tessdata_best repositories;
- permissive license is compatible with the current project direction.

Important default behavior:
- Tesseract.js normally downloads worker/core/language resources from CDN defaults unless paths are overridden.

ComeBackHome decision:
- any production Tesseract adapter must use explicit same-origin paths;
- external CDN runtime paths are rejected by the adapter;
- source schedule images stay in the browser and are not uploaded to an OCR service.

## Candidate 2 — Scribe.js

Repository: scribeocr/scribe.js

Observed version at evaluation: 0.16.1.

Fit:
- JavaScript OCR in browser/Node;
- project documentation describes improved OCR quality compared with Tesseract.js in many cases;
- supports local browser operation.

Blocker:
- license is AGPL-3.0;
- upstream documentation explicitly describes AGPL-compatible source obligations or a proprietary license for application use.

Decision:
- not selected as the ComeBackHome default dependency;
- reconsider only if the project licensing strategy changes or a proprietary license is obtained.

## Candidate 3 — PaddleOCR

Repository: PaddlePaddle/PaddleOCR

License: Apache-2.0.

Fit:
- strong multilingual/Korean OCR capabilities;
- bounding/structured document outputs are available in its ecosystem.

Blocker for current PWA path:
- official deployment stack is substantially heavier and primarily Python/native/server-oriented;
- it is not the simplest direct in-browser iPhone PWA adapter.

Decision:
- deferred as a potential server/local-native fallback, not the first browser prototype.

## Local sample evaluation

A local Tesseract 5.5.0 run with Korean+English on the four supplied screenshots was used as a feasibility probe.

The whole-image single-pass approach did not meet the product bar:
- dense table borders caused segmentation noise;
- small Korean names/labels were frequently corrupted;
- punctuation in decimal times could be lost, including patterns analogous to 23.5 -> 235;
- therefore full-image OCR text cannot be trusted directly as schedule data.

This evaluation does not mean Tesseract is rejected. It means the integration must use multiple evidence passes and human review.

## Phase 5W prototype architecture

TesseractScheduleImageTextExtractor runs two independent passes over a locally prepared raster:

1. general pass
   - languages: Korean + English;
   - sparse text segmentation;
   - captures names, dates, labels and other semantic anchors.

2. numeric pass
   - numeric/date/time character whitelist;
   - captures schedule numbers and punctuation separately.

Both request bbox-capable blocks output.

The extractor then:
- normalizes confidence;
- maps OCR coordinates back to source-image coordinates after any local scaling;
- merges overlapping evidence;
- may prefer an explicit decimal token such as 23.5 over overlapping punctuation-losing 235 when confidence remains comparable;
- never converts OCR output directly into ScheduleEntry.

The adaptive Phase 5V layout strategies remain responsible for semantic schedule interpretation.

## Local image preprocessing

BrowserScheduleOcrPreprocessor is local-only.

It can upscale small screenshots before OCR while preserving aspect ratio and maps all OCR boxes back to original source coordinates.

The preprocessor does not crop based on the current employer's row or column locations.

## Runtime asset policy

The TesseractJsWorkerFactory requires root-relative paths for:
- worker script;
- WASM core;
- traineddata.

External origins and protocol-relative URLs are rejected.

Phase 5W does not yet add the binary runtime assets to the repo. Production composition therefore still has no active OCR extractor.

A later activation phase must decide how the licensed worker/core/Korean traineddata assets are copied to same-origin static assets and cached by the PWA.

## Privacy

Current prototype:
- external OCR image upload = 0;
- cloud OCR API = 0;
- OCR credentials = 0;
- raw workplace screenshot committed to repo = 0.

Network access may eventually be used only to fetch same-origin static OCR runtime assets. That is different from uploading the schedule image itself.

## Current decision

Primary browser/PWA OCR candidate: Tesseract.js 7.0.0.

Production activation remains blocked until:
- same-origin worker/core/kor+eng traineddata asset packaging is implemented;
- actual iPhone/PWA performance is measured;
- local evaluation on the user's private screenshots demonstrates acceptable Korean/numeric evidence quality after preprocessing/multi-pass OCR;
- failure/ambiguity remains review-gated.
