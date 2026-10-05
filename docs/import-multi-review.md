# ComeBackHome Explicit Multi-item Import Review — Phase 5Q

Status: REVIEW SAFETY COMPLETE / OCR STILL DEFERRED

Phase 5Q closes the correctness gap created when the real XLSX parser began producing multiple imported schedule rows.

## Explicit review state

ImportReviewItem.resolution is now KEEP | NEW | null.

null means the imported row has not been explicitly reviewed by the user. Parser-created review rows always start at null regardless of whether an existing schedule is present.

The parser may still attach existing schedule data so the user can compare it, but the application does not convert that comparison into an automatic decision.

## Review page

ImportReviewPage renders every batch.reviewItems entry.

Each row keeps the existing visual decision language:
- date
- linked person
- existing schedule
- imported schedule
- one KEEP/NEW choice

There is one final Save action for the batch.

Save remains disabled unless every row:
- has a linked personId
- has a non-null resolution

An existing-schedule choice is disabled when there is no existing schedule. Both choices are disabled for an unresolved person.

## Person matching gate

ImportPersonMatchPage no longer labels null ownership as "새 사람" because no automatic Person creation contract exists.

It displays "연결 안 됨" and disables the next CTA while any detected person remains unmatched.

This prevents a user from reaching final review with ambiguous schedule ownership.

## Commit defense in depth

CommitImportReview independently validates:
1. every review row has person ownership,
2. every review row has an explicit resolution.

Therefore UI bypass, stale state, or a future caller cannot commit unseen/default import decisions.

Schedule mutation still occurs only after all validation and still uses one ScheduleRepository.upsertMany batch.

## Verification

Phase 5Q behavior tests prove:
- zero reviewed rows -> commit blocked
- one of two rows reviewed -> commit still blocked and no partial schedule mutation
- both rows reviewed -> both schedule rows commit
- unresolved person -> commit blocked
- UI does not use reviewItems[0]
- final Save depends on allReviewed

## Safety boundary

Phase 5Q does not implement image OCR, auto-create people, provider credentials, live external calls, remote Cloudflare resources or deployment.
