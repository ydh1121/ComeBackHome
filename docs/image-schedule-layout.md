# ComeBackHome Schedule Image Layout Contract — Phase 5V

Status: ADAPTIVE STRUCTURE PARSER IMPLEMENTED / OCR ENGINE NOT ACTIVATED / NO DEPLOY

Phase 5V uses the user's four workplace screenshots as one regression profile only. They are not a canonical layout specification. A later workplace may use different row order, column order, date orientation, labels, dimensions or table structure.

Raw screenshots are not committed to the public repository because they contain employee names and schedule information. Verification uses sanitized synthetic fixtures.

## Core rule

No absolute coordinate, employee row index, workplace-specific name position or fixed screenshot size is part of the product contract.

The parser must infer structure from OCR text, semantic labels and relative geometry. If the structure is not recognized with sufficient confidence, it fails closed and keeps the import in review rather than inventing a schedule.

## OCR evidence contract

ImageTextExtractor returns:

- text
- x / y
- width / height
- confidence
- image width / height

ImageScheduleRecognizer consumes that evidence. OCR and layout interpretation remain separate layers.

The OCR engine is not selected in Phase 5V.

## Adaptive layout strategies

parseScheduleImageLayout currently evaluates independent strategies.

### date-block-matrix

This strategy covers the supplied workplace sample class.

It recognizes repeated full-date blocks and semantic schedule labels such as 출근 / 퇴근 / 쉬는시간. It learns relative start/end/rest positions from the labels actually present in the image.

It does not require:
- exactly seven dates;
- a fixed screenshot size;
- equal-width start/end/rest thirds;
- a specific employee row;
- a specific employee name;
- the original pixel coordinates.

Person names are inferred from text rows outside the detected date grid rather than from a hard-coded x coordinate.

The supplied workplace screenshots happen to place employee names on the left; that is a property of this strategy profile, not a global image-import rule.

### row-table

This strategy covers a different class of employer schedule.

It finds a header row containing semantic person/date/start/end labels and infers the columns from the actual label x positions.

The columns may appear in any order. A verification fixture intentionally uses:

date | end | person | start

to prove that person need not be leftmost and start/end need not use the sample workplace positions.

## Strategy selection

Each strategy returns a score and ParsedImport candidate.

The adaptive parser:

1. evaluates all registered strategies;
2. rejects results below the confidence floor;
3. compares top candidates;
4. rejects near-tied candidates when their schedule interpretations differ;
5. returns only an unambiguous highest-confidence result.

Additional workplace formats are added as new strategies rather than by weakening existing parsers with guesses.

## Sample workplace profile

The four supplied screenshots are useful regression evidence for one profile:

- horizontal date blocks;
- full YYYY-MM-DD date labels;
- repeated 출근 / 퇴근 / 쉬는시간 labels;
- employee rows;
- optional special-note text around the header area;
- blank schedule cells for off/no-work states;
- decimal half-hour notation such as 23.5.

The target person's row position is not stable and is not assumed by code or tests.

Special-note text is not schedule data merely because it contains numbers.

Blank/colored cells do not become schedules unless OCR provides a complete start/end pair under a recognized strategy.

## Decimal time rule

For the supplied profile, strict normalization is:

- 9 -> 09:00
- 11 -> 11:00
- 10.5 -> 10:30
- 12.5 -> 12:30
- 20.5 -> 20:30
- 23.5 -> 23:30

Only integer hours, .0 and .5 fractions are accepted by this shared time parser. Unsupported fractions such as .25 are rejected rather than guessed.

A comma decimal such as 23,5 may normalize to 23:30 as a narrow OCR punctuation correction.

A future workplace with a different time notation must add an explicitly tested normalization rule instead of reinterpreting arbitrary decimals.

## Import pipeline integration

WorkbookImportFileSelectionAction accepts an optional ImageScheduleRecognizer.

- recognizer supplied -> image starts PARSING and may become READY;
- recognizer absent -> image remains ERROR and an image-only import fails closed;
- image-derived candidates enter the same person-match / structure-review / explicit KEEP-or-NEW review pipeline as XLSX;
- every image-derived structure sets needsReview=true;
- image recognition never directly commits a schedule.

## Regression requirements

Phase 5V verifies:

- the sanitized sample-profile geometry;
- the target person moved to another row;
- translated and non-uniformly scaled geometry;
- a structurally different row-table format;
- non-leftmost person column;
- nonstandard column ordering;
- numeric note text excluded from schedules;
- blank/off cells suppressed;
- .5 half-hour conversion;
- unsupported decimal rejection;
- unrecognized layout fail-closed behavior.

## Project OCR skill

Project-local instructions are stored at:

skills/schedule-image-ocr/SKILL.md

The skill was created under the Harness after reviewing user-approved external OCR references. It requires local-first processing where practical, bbox/confidence evidence, strategy-based parsing, fail-closed ambiguity handling and explicit privacy documentation for any future external OCR/AI service.

## Privacy

Raw workplace screenshots and employee names are not repository fixtures.

The committed fixtures preserve only structural characteristics needed to test the parser.

If a future OCR engine sends images to an external service, the architecture must first identify exactly what personal data leaves the device and obtain explicit approval for that live path.

## Current activation boundary

Phase 5V does not choose or activate an OCR engine.

No Tesseract.js, CDN OCR, cloud OCR, external vision API or OCR credential is added yet.

The next image-import phase must evaluate OCR adapters for Korean text, numeric fidelity, bounding boxes, iPhone/PWA runtime cost, privacy and offline/network behavior. The supplied screenshots may be used locally for evaluation but must not be committed to the public repository.

## Safety boundary

Phase 5V does not:

- upload workplace screenshots;
- persist OCR source images;
- activate a cloud OCR service;
- add OCR credentials;
- assume the current workplace layout is permanent;
- activate live push/provider runtime;
- mutate remote D1;
- deploy Cloudflare.
