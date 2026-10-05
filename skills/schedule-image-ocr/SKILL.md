---
name: comebackhome-schedule-image-ocr
description: Parse schedule screenshots conservatively from OCR text+bbox evidence without assuming a fixed workplace layout. Use for image schedule import, OCR adapter work, layout strategy changes, and image-import QA.
---

# ComeBackHome Schedule Image OCR Skill

## Authority

Follow this order:

1. current user instruction;
2. ComeBackHome Durable SSOT / Harness;
3. actual Git source and tests;
4. user-approved external OCR references;
5. historical chat context.

The user's supplied workplace screenshots are samples and regression evidence only. They are never a canonical layout specification.

## External references applied

### 1m01m0/image-vision-bridge

License: MIT.

Adopted principles only:

- OCR evidence should include text plus bounding boxes/coordinates.
- Prefer local processing where practical.
- OCR output is evidence, not semantic truth.
- Preserve source geometry for downstream layout inference.

Not adopted:

- macOS Vision implementation;
- bundled shell/JXA scripts;
- automatic external vision API upload;
- preconfigured external credentials.

### document-ocr reference

The repository was reviewed for architecture ideas such as separating OCR, layout analysis and quality assessment. No license file was found during the review, so no source code or substantial text from that repository may be copied into ComeBackHome.

## Non-negotiable parser rules

- Do not assume a person's row index.
- Do not assume employee names are in the leftmost column.
- Do not assume dates are always horizontal.
- Do not assume seven days are visible.
- Do not assume start/end/rest are always three equal subcolumns.
- Do not assume the next workplace uses the current workplace format.
- Never infer a missing schedule from cell background color alone.
- Red/colored notes are not schedule data unless a recognized layout strategy explicitly proves that they belong to a schedule field.
- OCR numbers are candidates. Unsupported or ambiguous time syntax must fail rather than be guessed.
- Decimal half-hour notation may normalize .5 to :30; arbitrary fractions are invalid unless a future approved parser explicitly defines them.

## OCR evidence contract

OCR adapters should output:

- original text;
- x/y;
- width/height;
- confidence;
- image width/height.

Coordinates may be absolute pixels or normalized by the adapter, but the application parser must operate on relative geometry derived from the actual image dimensions.

The OCR adapter must not return application ScheduleEntry objects directly.

## Strategy architecture

Image recognition is a two-stage pipeline:

1. OCR/Text extraction produces ImageTextLayout.
2. Layout strategies independently attempt to convert that evidence into ParsedImport.

Each strategy must:

- identify its semantic anchors;
- infer columns/rows from relative token topology;
- return a score/confidence;
- include only complete person/date/start/end candidates;
- avoid absolute pixel positions;
- be independently regression-tested.

Examples of valid strategies:

- weekday/date block matrix;
- row-oriented table with person/date/start/end headers;
- future strategies for employer-specific or calendar-style layouts.

The adaptive parser may choose the highest-confidence strategy only when the result is unambiguous. If no strategy is strong enough or two materially different interpretations are too close, fail closed and require review/manual mapping.

## Human review

Every image-derived import must keep needsReview=true.

OCR/image recognition must never bypass:

- person matching;
- structure review;
- explicit KEEP/NEW decision;
- final commit guard.

## Privacy

Raw workplace schedule screenshots may contain employee names and working hours.

- Do not commit raw screenshots to the public repository.
- Prefer local/on-device OCR when practical.
- If an external OCR/AI API is considered, architecture documentation must state exactly what image/data leaves the device and the user must explicitly approve that live path.
- Do not persist source images merely to perform parsing unless separately approved.

## QA requirements

At minimum, image-import tests must cover:

- translated/scaled geometry;
- target person moved to another row;
- multiple people;
- blank/off cells;
- note text containing numbers;
- .5 half-hour normalization;
- unsupported time rejection;
- at least two structurally different layout strategies;
- ambiguous/unrecognized layout fail-closed behavior.

A test fixture modeled after one employer must be labeled as a sample profile, never as the general parser contract.

## OCR engine selection rule

Current Phase 5W primary browser candidate is Tesseract.js 7.0.0.

Reasons:
- Apache-2.0;
- browser WebWorker/WebAssembly runtime;
- bbox/confidence-capable blocks output;
- Korean traineddata exists;
- runtime worker/core/lang paths are configurable for same-origin hosting.

Do not use Tesseract.js default CDN runtime paths in production. The ComeBackHome adapter requires same-origin root-relative worker/core/lang paths.

Scribe.js is not the default candidate because its current package is AGPL-3.0 and upstream documentation describes AGPL-compatible source obligations or proprietary licensing for application use.

PaddleOCR remains a deferred candidate because its current official deployment path is substantially heavier for an iPhone PWA.

A single whole-image OCR pass is not sufficient evidence for dense schedule screenshots. Use multiple evidence passes and retain bbox/confidence. OCR output must still pass adaptive layout parsing and explicit human review.

## Same-origin runtime asset rule

When Tesseract.js is activated, runtime assets must be version-pinned and same-origin.

Current runtime ID:
- tesseract-7.0.0-data-1.0.0

Required package sources:
- tesseract.js 7.0.0
- tesseract.js-core 7.0.0
- @tesseract.js-data/kor 1.0.0
- @tesseract.js-data/eng 1.0.0

Use scripts/prepare-ocr-assets.mjs to stage runtime files from installed npm packages. Do not download runtime assets from CDN during recognition.

The staging output must include a SHA-256 manifest. A package-version mismatch, missing runtime file, or non-root-relative public path is a hard failure.

Do not silently add OCR staging to the normal production build while OCR remains disabled. Production asset activation is a separate reviewed step.

## Local distribution smoke rule

Before production OCR activation, the versioned OCR runtime must survive an actual Vite public-copy/build/serve path.

Phase 5Y verification must:
- stage into an isolated temporary public directory;
- build with Vite without changing the default production build command;
- serve the temporary build from 127.0.0.1 only;
- fetch every manifest-tracked runtime file over that same local origin;
- compare served byte length and SHA-256 with the staging manifest;
- reject redirects outside the local origin;
- clean the temporary build/staging area after verification.

This distribution smoke uses no workplace screenshot and does not activate TesseractScheduleImageTextExtractor in application composition.

## Traineddata HTTP gzip rule

When same-origin .traineddata.gz is served with Content-Encoding: gzip, browser fetch may expose the transparently decoded raw traineddata bytes. This is valid for Tesseract.js because its worker only gunzips when gzip magic is still present.

Distribution verification must therefore keep strict staged/built SHA-256 checks, while HTTP verification for traineddata may accept either:
- exact gzip bytes; or
- a gzip-encoded HTTP response whose decoded body equals gunzip(the staged file).

Do not generalize this exception to worker/core or unrelated assets.

## Private evaluation harness rule

Real workplace screenshots may be evaluated only through a local/non-production path unless the user explicitly approves another path.

The Phase 5Z harness:
- binds to 127.0.0.1 only;
- accepts the screenshot from a browser file input;
- uses the same project Tesseract extractor and adaptive parser;
- must not upload or persist the source screenshot;
- may display OCR evidence, bbox, confidence, latency and parser output for human review;
- must not commit schedule data or bypass existing review guards;
- must not be imported into production app composition.

Static OCR model/traineddata caching is distinct from source-image persistence. Never describe cached language model data as a persisted user screenshot.

## Sparse horizontal calendar reconstruction rule

A horizontal weekly/calendar strategy may reconstruct missing date cells only when structural weekday evidence supports it.

Allowed:
- derive relative day spacing from a coherent top-row weekday sequence;
- use surviving full-date tokens to derive a consensus base date;
- fill only consecutive columns evidenced by that strip;
- accept calendar-validated YYYYMMDD when OCR loses date punctuation;
- assign lower confidence to inferred dates;
- fail closed when weekday geometry or date consensus conflicts.

Not allowed:
- hard-code the current employer's pixel coordinates;
- assume every image has seven days;
- treat a date inferred from color or empty grid position as truth;
- apply the horizontal-calendar rule to unrelated table strategies.

## Person row identity trust rule

Preserving a row boundary and trusting the row's person text are separate decisions.

A weak OCR fragment may remain as a geometric row anchor so neighboring schedules do not shift rows, while being excluded from detectedPeople and from schedule-candidate emission.

Current conservative trust thresholds are implementation guards, not identity truth. Every image-derived identity still requires review/matching before commit.
