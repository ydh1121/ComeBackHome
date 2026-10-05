# ComeBackHome Real Workbook Import — Phase 5P

Status: XLSX PARSER ACTIVE / IMAGE RECOGNITION DEFERRED / NO DEPLOY

Phase 5P replaces the mock import-file action with a real browser XLSX parser while preserving the existing Import -> Person Match -> Structure Review -> Conflict Review flow.

## Parser implementation

The active WorkbookParser is ReadExcelWorkbookParser.

It uses read-excel-file 9.3.10 through the universal ArrayBuffer entrypoint. The parser reads workbook sheet data in the browser without sending the workbook to a server.

Recognized row-oriented header aliases include:

- person: 이름, 성명, 직원, 직원이름, 사람, name, person, employee
- date: 날짜, 일자, 근무일, 근무날짜, date, workdate
- start: 출근, 출근시간, 시작, 시작시간, 근무시작, start, starttime
- end: 퇴근, 퇴근시간, 종료, 종료시간, 근무종료, end, endtime
- combined shift: 근무시간, 근무, 시간, shift, worktime, workinghours

The first ten rows are eligible for header detection.

## Normalized parser output

WorkbookParser returns typed ParsedImport data:

- detectedPeople
- scheduleCandidates
- structure
- confidence

Schedule candidates contain sourcePersonName, ISO date, start/end HH:mm, source row and confidence.

The UI still consumes ImportBatch and never imports XLSX-library types.

## Time and date rules

Supported date values:

- XLSX Date cells
- YYYY-MM-DD
- YYYY.MM.DD
- YYYY/MM/DD

Supported time values:

- XLSX time cells
- numeric day fractions from 0 to less than 1
- HH:mm
- compact HHmm
- 오전/오후 H:mm

Combined shift cells accept separators such as -, ~, en dash or em dash.

A row that cannot produce person + full date + start + end is not converted into a schedule candidate. The parser does not guess a missing year or a missing time.

## Multi-person / multi-file behavior

ONE FILE != ONE PERSON remains the product rule.

Parsed people are deduplicated by normalized name. Multiple workbook files can contribute to one import preview. If multiple workbook results or duplicate person/date candidates are present, structure.needsReview remains true.

For duplicate imported person/date rows, the first deterministic candidate is retained and the structure is flagged for review. Phase 5P does not silently overwrite one imported row with another.

## Person matching

The import application service exact-matches normalized detected names against existing PersonRepository names.

- exact match -> matchedPersonId is assigned automatically
- no exact match -> matchedPersonId remains null
- changing the person match propagates to all review items linked by detectedPersonId
- CommitImportReview rejects any batch containing unresolved person ownership

Phase 5P does not auto-create a new Person because the Person domain requires user-owned relation data that the workbook does not provide.

## Conflict and commit rules

For a matched person/date, the parser attaches existing schedule data when present but does not choose a resolution.

As of Phase 5Q every parser-created review row starts with resolution = null and requires an explicit KEEP or NEW decision before final commit.

Final commit still uses ScheduleRepository.upsertMany, preserving the D1 batch boundary in hybrid API mode.

Import preview remains runtime-only. Parsed workbook contents are not persisted as D1 import artifacts.

## Image files

The XLSX parser remains independent from image recognition.

As of Phase 5V, the import action may receive an ImageScheduleRecognizer. When one is supplied, image-derived ParsedImport data enters the same person-match, structure-review and explicit schedule-review pipeline as workbook data.

The production composition still supplies no OCR ImageTextExtractor, so image import remains fail-closed until an OCR adapter is explicitly selected and wired.

No image upload or external OCR service is activated by the workbook parser.

## Hybrid API change

The previous hybrid safety block existed because import data was mock-backed.

After Phase 5P:
- importFiles uses the real workbook parser
- parsed preview stays in runtime memory
- people matching reads the Worker-backed PersonRepository
- final reviewed schedule commit uses Worker-backed ScheduleRepository / D1 batch write

Only source-grounded XLSX rows may reach that commit path.

## Dependency

read-excel-file 9.3.10 is pinned in package.json. It supports browser/Node XLSX reading and an ArrayBuffer-compatible universal entrypoint.

## Safety boundary

Phase 5P does not:
- activate an OCR engine or external OCR service
- upload workbook contents or schedule screenshots
- add provider credentials
- activate Kakao
- activate push delivery
- create or mutate remote D1
- deploy Cloudflare
