# ComeBackHome Schedule Image Layout Contract — Phase 5V

Status: STRUCTURE PARSER IMPLEMENTED / OCR ENGINE NOT ACTIVATED / NO DEPLOY

Phase 5V is based on four real schedule screenshots supplied by the user from the current workplace workflow. The raw screenshots are not committed to the public repository because they contain employee names and schedule information. Verification uses a synthetic fixture with the same geometry and semantics.

## Observed source format

The reference images are 1735x270 schedule-table screenshots.

The stable structure is:

1. seven weekday blocks from Monday through Sunday;
2. one full YYYY-MM-DD date per weekday block;
3. an optional note/special-event row between the date and schedule-column labels;
4. three repeated subcolumns per date: 출근 / 퇴근 / 쉬는시간;
5. employee names in the far-left column;
6. one employee row per person.

Special-event text in the note row is not schedule data and must be ignored even if it contains numbers.

Blank gray/yellow schedule cells are treated as no schedule candidate because no complete start/end pair exists.

## Decimal time rule

The observed schedule uses decimal-like half-hour notation.

Strict normalization:

- 9 -> 09:00
- 11 -> 11:00
- 10.5 -> 10:30
- 12.5 -> 12:30
- 20.5 -> 20:30
- 23.5 -> 23:30

Only integer hours, .0 and .5 fractions are accepted. Unsupported fractions such as .25 are rejected rather than guessed.

A comma decimal such as 23,5 may be normalized to 23:30 as a low-risk OCR punctuation correction.

The 쉬는시간 column is not used to create ScheduleEntry start/end data.

## Structure parser

StructuredTableImageScheduleRecognizer consumes an injected ImageTextExtractor.

The extractor contract returns text tokens with:
- text
- x/y
- width/height
- confidence

The structure parser then:

1. finds full date header tokens;
2. infers each weekday block from date-center spacing;
3. identifies the schedule-label row;
4. treats everything above that row as non-schedule header/note content;
5. identifies person rows only in the left name band below the labels;
6. divides every date block into start/end/rest thirds;
7. maps time tokens to person row + date + subcolumn;
8. emits a schedule candidate only when both start and end are recognized.

Image-derived structures always set needsReview=true.

## Import pipeline integration

WorkbookImportFileSelectionAction now accepts an optional ImageScheduleRecognizer.

- recognizer supplied -> image starts PARSING and may become READY;
- recognizer absent -> image remains ERROR and import fails closed when no other supported file succeeds;
- image-derived candidates enter the same person-match / structure-review / explicit schedule-review pipeline as XLSX candidates;
- image recognition never bypasses explicit review.

## Privacy rule

Raw workplace screenshots and employee names are not repository fixtures.

The committed synthetic fixture copies only the table geometry and schedule notation required to verify the parser.

## Current activation boundary

Phase 5V does not choose or activate an OCR engine.

No Tesseract/CDN/cloud OCR/API credential is added yet. This is deliberate: OCR runtime choice must account for Korean recognition quality, iPhone/PWA performance, privacy, bundle/runtime size and offline/network behavior.

The next image-import step is an OCR adapter evaluation against the supplied screenshots, without committing those screenshots to the public repository.

## Safety boundary

Phase 5V does not:
- upload workplace screenshots;
- persist OCR source images;
- activate a cloud OCR service;
- add OCR credentials;
- activate live push/provider runtime;
- mutate remote D1;
- deploy Cloudflare.
