# ComeBackHome Safe Compact Half-Hour Recovery — Phase 5AD

Status: IMPLEMENTED / PRIVATE SAMPLE RE-RUN REQUIRED / PRODUCTION OCR DISABLED

Phase 5AC private QA showed that calendar-strip reconstruction fixed the sparse-date geometry and removed weak false person identities, but OCR still frequently drops the decimal point from half-hour schedule notation.

Observed examples include numeric evidence such as 95, 105, 125, 135, 205 and 235 where the corresponding schedule notation is 9.5, 10.5, 12.5, 13.5, 20.5 and 23.5.

## Recovery rule

parseScheduleHour now restores a missing half-hour decimal only when all of the following are true:

1. the token contains digits only;
2. the token ends in 5;
3. the raw integer is greater than 23, so it cannot itself be a valid 24-hour time;
4. removing the final 5 leaves a valid hour from 0 through 23.

Examples:

- 95 -> 09:30
- 105 -> 10:30
- 125 -> 12:30
- 135 -> 13:30
- 205 -> 20:30
- 215 -> 21:30
- 235 -> 23:30

## Values that remain unchanged or rejected

The rule must not reinterpret a valid integer hour:

- 15 -> 15:00
- 23 -> 23:00

The rule must not guess ambiguous or invalid OCR:

- 285 -> rejected
- 211 -> rejected
- 2395 -> rejected

This keeps the repair narrow. It restores only punctuation loss that can be proven impossible as an unpunctuated 24-hour value.

## Scope

The rule is schedule-time normalization, not a coordinate/layout patch.

It therefore applies across supported image strategies, including date-block matrices and row-oriented tables, without assuming the current employer, person row or pixel position.

## Regression fixture

A synthetic Phase 5AD fixture starts from the sparse-calendar fixture and removes every .5 decimal point from schedule times.

The expected parsed schedule must remain identical to the original schedule after safe compact recovery.

No private workplace OCR dump or image is committed.

## Safety

- review required = preserved
- source screenshot commit = 0
- private OCR dump commit = 0
- external screenshot upload = 0
- cloud OCR API = 0
- production OCR activation = 0
- remote D1/Cron/deploy = 0

After CI passes, the same four private screenshots must be re-run once through the batch harness. If values are still absent because OCR never emitted any usable numeric token, the next repair belongs in targeted OCR extraction rather than parser guessing.
