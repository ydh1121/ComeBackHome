# External OCR Skill Review

Reviewed under the ComeBackHome Harness after explicit user instruction.

## 1m01m0/image-vision-bridge

- GitHub SKILL.md reviewed.
- License: MIT.
- Useful architectural idea: text + bounding-box OCR evidence and local-first processing.
- Not runtime-compatible as-is because its primary implementation is macOS Vision/JXA.
- Its optional external vision API route is not adopted because ComeBackHome must explicitly document and approve personal-data transmission before any external OCR/AI API use.

## dreamjorge/ledger-smart-converter OCR debug skill

- Reviewed.
- Primarily PDF/Tesseract debugging guidance.
- Not a direct fit for browser/PWA schedule screenshots.
- No code adopted.

## leonamdeoliveira/document-ocr

- Reviewed for high-level hybrid OCR/layout/quality architecture.
- No LICENSE or LICENSE.md was found at review time.
- No code or substantial text adopted.
- Only generic architectural ideas that are independently implemented may be used.

## Project decision

ComeBackHome maintains its own schedule-image OCR skill and interface. External references inform design principles only; the production OCR engine remains an explicit future adapter decision.

## Phase 5W engine evaluation

### naptha/tesseract.js
- Version reviewed: 7.0.0.
- License: Apache-2.0.
- Browser WebWorker/WASM supported.
- Word/block structures expose bbox and confidence.
- Runtime worker/core/lang locations are configurable.
- Korean traineddata exists in official tesseract-ocr tessdata repositories.
- Selected as the current local-first browser prototype candidate.

### scribeocr/scribe.js
- Version reviewed: 0.16.1.
- License: AGPL-3.0.
- Browser OCR is technically suitable, and upstream describes accuracy advantages over Tesseract.js in some cases.
- Not selected because the licensing model does not fit the current project direction without AGPL-compatible distribution or a proprietary license.

### PaddlePaddle/PaddleOCR
- License: Apache-2.0.
- Strong multilingual/Korean OCR.
- Deferred because the official runtime/deployment stack is materially heavier and is not the simplest direct iPhone PWA browser adapter.
