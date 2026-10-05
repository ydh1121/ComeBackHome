# ComeBackHome Calendar Strip Reconstruction — Phase 5AB

Status: IMPLEMENTED / PRIVATE SAMPLE RE-RUN REQUIRED / PRODUCTION OCR DISABLED

Phase 5AA private QA showed that the OCR engine can preserve enough structural evidence for a weekly schedule while missing several full-date strings. The previous parser built day-block widths only from the surviving date tokens. That made sparse date OCR distort the whole calendar geometry.

Phase 5AB fixes that structural defect without encoding the supplied workplace coordinates.

## Strategy

The date-block matrix strategy now has an optional horizontal calendar-strip reconstruction layer.

It looks for a top-row weekday sequence. It supports:

- Korean weekday tokens;
- English weekday names, including common OCR truncation where the final y is missing.

When at least three coherent weekday anchors are present, the parser:

1. keeps only the top weekday band;
2. chooses one weekday-script family rather than mixing offsets from Korean and English labels;
3. unwraps the weekday order;
4. estimates the day-column spacing from relative x geometry;
5. rejects the strip when anchor residuals are too large;
6. maps surviving full-date tokens into those day columns;
7. derives a consensus base date;
8. fills only the consecutive columns actually evidenced by the weekday strip;
9. assigns conservative confidence to inferred dates.

This is a strategy-specific reconstruction. It does not change the rule that dates need not always be horizontal in future layouts.

## Compact date OCR

The schedule-date parser now accepts:

- YYYY-MM-DD
- YYYYMMDD

Both forms are calendar-validated. Invalid dates fail closed.

Compact recognition is useful when OCR loses punctuation but preserves all eight date digits.

## Person identity trust

Row geometry and person identity are now separate.

A weak OCR fragment can still preserve the vertical row boundary so adjacent schedules do not shift into another person. But that weak fragment is not promoted into detectedPeople and cannot emit schedule candidates.

Current conservative identity trust:

- Hangul-containing identity: at least two normalized characters and confidence >= 0.68;
- Latin-only identity: at least two characters, name-like characters only, confidence >= 0.90.

This is intentionally conservative because every image import remains review-only.

## No private fixture commit

The user-supplied OCR dumps were used only as private QA evidence. They are not committed.

Repository regression uses a synthetic fixture with:

- a seven-day weekday strip;
- sparse full-date OCR;
- one compact YYYYMMDD date;
- a weak Latin row fragment;
- movable target row;
- ordinary start/end/rest evidence.

## Remaining OCR limitation

This repair addresses parser geometry. It does not claim to recover schedule values that Tesseract did not recognize.

Phase 5AA also showed punctuation-losing numeric evidence and completely missing schedule-cell values. After Phase 5AB passes CI, the same private screenshots must be re-run. If the remaining gap is numeric OCR evidence rather than layout mapping, the next repair belongs in the OCR extraction stage, not in calendar coordinate guessing.

## Safety boundary

- raw screenshot commit = 0
- private OCR dump commit = 0
- external screenshot upload = 0
- cloud OCR API = 0
- production OCR composition activation = 0
- remote D1/Cron/deploy = 0
