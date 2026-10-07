import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createServer as createViteServer } from 'vite';
import {
  buildRowOrientedScheduleLayoutFixture,
  buildScheduleImageLayoutFixture,
  buildSparseCalendarDateScheduleLayoutFixture,
  transformImageLayout,
} from '../test/fixtures/import/sample-image-layout.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const skillSource = await readFile(
  new URL('../skills/schedule-image-ocr/SKILL.md', import.meta.url),
  'utf8',
);
for (const text of [
  "Do not assume a person's row index.",
  'Do not assume employee names are in the leftmost column.',
  'Do not assume dates are always horizontal.',
  'Do not assume seven days are visible.',
  'Do not assume start/end/rest are always three equal subcolumns.',
  'fail closed',
  'external OCR/AI API',
]) {
  expect(skillSource.includes(text), 'project OCR skill missing rule: ' + text);
}

function targetSchedules(parsed, name = '테스트직원') {
  return parsed.scheduleCandidates.filter((item) => item.sourcePersonName === name);
}

function expectReferenceTarget(parsed, prefix) {
  const target = targetSchedules(parsed);
  expect(target.length === 5, prefix + ' target candidate count mismatch');

  const expected = [
    ['2026-08-18', '12:00', '23:30'],
    ['2026-08-20', '12:00', '23:30'],
    ['2026-08-21', '11:00', '23:30'],
    ['2026-08-22', '10:30', '20:30'],
    ['2026-08-23', '10:30', '20:00'],
  ];

  expected.forEach(([date, start, end]) => {
    const item = target.find((candidate) => candidate.date === date);
    expect(item?.start === start && item?.end === end, prefix + ' schedule mismatch for ' + date);
  });

  expect(!target.some((item) => item.date === '2026-08-17'), prefix + ' blank/off Monday created schedule');
  expect(!target.some((item) => item.date === '2026-08-19'), prefix + ' blank/off Wednesday created schedule');
}

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const imageModule = await vite.ssrLoadModule('/src/providers/import/StructuredTableImageScheduleRecognizer.ts');
  const serviceModule = await vite.ssrLoadModule('/src/application/services/WorkbookImportFileSelectionAction.ts');
  const reposModule = await vite.ssrLoadModule('/src/mocks/repositories.ts');
  const stateModule = await vite.ssrLoadModule('/src/mocks/state.ts');

  expect(imageModule.parseScheduleHour('23.5') === '23:30', '23.5 must normalize to 23:30');
  expect(imageModule.parseScheduleHour('10.5') === '10:30', '10.5 must normalize to 10:30');
  expect(imageModule.parseScheduleHour('12') === '12:00', 'integer hour must normalize to :00');
  expect(imageModule.parseScheduleHour('23,5') === '23:30', 'OCR comma decimal must normalize safely');
  expect(imageModule.parseScheduleHour('23.25') === null, 'unsupported decimal fraction must be rejected');
  expect(imageModule.parseScheduleHour('24') === null, 'hour 24 must be rejected');
  expect(
    imageModule.parseScheduleDate('20260815') === '2026-08-15',
    'compact YYYYMMDD date OCR must normalize safely',
  );
  expect(
    imageModule.parseScheduleDate('2026-08-15') === '2026-08-15',
    'dashed date OCR must remain supported',
  );
  expect(
    imageModule.parseScheduleDate('20261340') === null,
    'invalid compact date OCR must be rejected',
  );

  const sampleProfile = buildScheduleImageLayoutFixture({ targetRow: 3 });
  const parsedSample = imageModule.parseScheduleImageLayout(sampleProfile);

  expect(parsedSample.structure.sheet.includes('date-block-matrix'), 'sample profile must use date-block strategy');
  expect(parsedSample.structure.needsReview === true, 'image recognition must always require review');
  expect(parsedSample.detectedPeople.length === 6, 'sample profile person row count mismatch');
  expect(parsedSample.detectedPeople.some((person) => person.sourceName === '테스트직원'), 'sample profile target person not detected');
  expectReferenceTarget(parsedSample, 'sample profile');
  expect(
    !parsedSample.scheduleCandidates.some((item) => item.start === '17:30' || item.end === '17:30'),
    'sample profile note-row number leaked into schedule data',
  );

  const movedTarget = buildScheduleImageLayoutFixture({ targetRow: 1 });
  const movedParsed = imageModule.parseScheduleImageLayout(movedTarget);
  expectReferenceTarget(movedParsed, 'moved target row');
  expect(
    movedParsed.scheduleCandidates.some((item) => item.sourcePersonName === '테스트직원'),
    'target person must not depend on original row index',
  );

  const unseenSourceName = '처음보는신규직원';
  const unseenLayout = buildScheduleImageLayoutFixture({ targetRow: 4 });
  unseenLayout.tokens = unseenLayout.tokens.map((item) =>
    item.text === '테스트직원'
      ? { ...item, text: unseenSourceName, confidence: 0.97 }
      : item
  );
  const unseenParsed = imageModule.parseScheduleImageLayout(unseenLayout);
  expect(
    unseenParsed.detectedPeople.some((person) => person.sourceName === unseenSourceName),
    'unseen OCR row label must be preserved without a registry dependency',
  );
  expect(
    targetSchedules(unseenParsed, unseenSourceName).length === 5,
    'unseen OCR row label must retain its schedule candidates',
  );

  const sparseCalendar = buildSparseCalendarDateScheduleLayoutFixture({ targetRow: 3 });
  const sparseParsed = imageModule.parseScheduleImageLayout(sparseCalendar);
  expect(
    sparseParsed.structure.sheet.includes('calendar-strip'),
    'sparse full-date OCR must use calendar-strip reconstruction',
  );
  expectReferenceTarget(sparseParsed, 'sparse calendar reconstruction');
  expect(
    !sparseParsed.detectedPeople.some((person) => /^a?ach$/i.test(person.sourceName)),
    'weak Latin OCR fragment must not be promoted to a detected person',
  );
  expect(
    !sparseParsed.scheduleCandidates.some((item) => /^a?ach$/i.test(item.sourcePersonName)),
    'weak person identity row must not emit schedule candidates',
  );

  const transformed = transformImageLayout(
    buildScheduleImageLayoutFixture({ targetRow: 5 }),
    { scaleX: 1.37, scaleY: 1.22, offsetX: 83, offsetY: 41 },
  );
  const transformedParsed = imageModule.parseScheduleImageLayout(transformed);
  expectReferenceTarget(transformedParsed, 'translated/scaled profile');
  expect(
    transformedParsed.structure.sheet.includes('date-block-matrix'),
    'translated/scaled profile changed strategy unexpectedly',
  );

  const rowTable = buildRowOrientedScheduleLayoutFixture();
  const rowParsed = imageModule.parseScheduleImageLayout(rowTable);
  expect(rowParsed.structure.sheet.includes('row-table'), 'row-oriented fixture must use row-table strategy');
  expect(rowParsed.structure.needsReview === true, 'row-table image must require review');

  const rowTarget = targetSchedules(rowParsed);
  expect(rowTarget.length === 1, 'row-table target candidate count mismatch');
  expect(rowTarget[0]?.date === '2026-09-02', 'row-table target date mismatch');
  expect(rowTarget[0]?.start === '10:30', 'row-table target start mismatch');
  expect(rowTarget[0]?.end === '20:00', 'row-table target end mismatch');

  const genericRow = {
    width: 1080,
    height: 520,
    tokens: [
      { text: '2026년10월', x: 40, y: 24, width: 150, height: 24, confidence: 0.98 },
      { text: '10/22', x: 40, y: 110, width: 70, height: 24, confidence: 0.96 },
      { text: '여자친구', x: 180, y: 110, width: 100, height: 24, confidence: 0.97 },
      { text: '09:00~18:00', x: 400, y: 110, width: 180, height: 24, confidence: 0.98 },
      { text: '10/23', x: 40, y: 170, width: 70, height: 24, confidence: 0.96 },
      { text: '여자친구', x: 180, y: 170, width: 100, height: 24, confidence: 0.97 },
      { text: '10:30-19:30', x: 400, y: 170, width: 180, height: 24, confidence: 0.98 },
    ],
  };
  const genericParsed = imageModule.parseScheduleImageLayout(genericRow);
  expect(genericParsed.structure.sheet.includes('generic-row'), 'generic row fixture must use generic-row strategy');
  expect(genericParsed.scheduleCandidates.length === 2, 'generic row schedule count mismatch');
  expect(genericParsed.scheduleCandidates[0]?.date === '2026-10-22', 'generic row inferred date mismatch');
  expect(
    genericParsed.scheduleCandidates[0]?.start === '09:00' &&
      genericParsed.scheduleCandidates[0]?.end === '18:00',
    'generic row time range mismatch',
  );

  const calendarCell = {
    width: 1000,
    height: 420,
    tokens: [
      { text: '2026-10-22', x: 260, y: 55, width: 120, height: 24, confidence: 0.98 },
      { text: '2026-10-23', x: 620, y: 55, width: 120, height: 24, confidence: 0.98 },
      { text: '여자친구', x: 60, y: 155, width: 110, height: 24, confidence: 0.98 },
      { text: '09:00', x: 245, y: 155, width: 70, height: 24, confidence: 0.97 },
      { text: '18:00', x: 335, y: 155, width: 70, height: 24, confidence: 0.97 },
      { text: '10:30', x: 605, y: 155, width: 70, height: 24, confidence: 0.97 },
      { text: '19:30', x: 695, y: 155, width: 70, height: 24, confidence: 0.97 },
    ],
  };
  const calendarCellParsed = imageModule.parseScheduleImageLayout(calendarCell);
  expect(
    calendarCellParsed.structure.sheet.includes('calendar-cell-time-pair'),
    'calendar cells without start/end headers must use time-pair fallback',
  );
  expect(calendarCellParsed.scheduleCandidates.length === 2, 'calendar cell fallback candidate count mismatch');
  expect(
    calendarCellParsed.scheduleCandidates[0]?.start === '09:00' &&
      calendarCellParsed.scheduleCandidates[0]?.end === '18:00',
    'calendar cell fallback first time pair mismatch',
  );

  let unknownBlocked = false;
  try {
    imageModule.parseScheduleImageLayout({
      width: 900,
      height: 400,
      tokens: [
        { text: '알림', x: 100, y: 60, width: 80, height: 20, confidence: 0.99 },
        { text: '테스트직원', x: 100, y: 140, width: 100, height: 20, confidence: 0.99 },
        { text: '23.5', x: 400, y: 140, width: 50, height: 20, confidence: 0.99 },
      ],
    });
  } catch (error) {
    unknownBlocked = error instanceof Error &&
      error.message.includes('근무표 구조를 충분히 인식하지 못했습니다');
  }
  expect(unknownBlocked, 'unrecognized layout must fail closed instead of guessing');

  const recognizer = new imageModule.AdaptiveScheduleImageRecognizer({
    async extract() {
      return buildScheduleImageLayoutFixture({ targetRow: 2 });
    },
  });

  const direct = await recognizer.parse({
    name: 'synthetic-schedule.png',
    type: 'image/png',
  });
  expectReferenceTarget(direct, 'recognizer/extractor composition');

  const store = new stateModule.MockStateStore(structuredClone(stateModule.MOCK_FIXTURE));
  store.mutate((state) => {
    state.people = [{ id: 'mock-person-1', name: '테스트직원', relation: '연인' }];
    state.importBatches = [];
    state.schedules = state.schedules.filter((entry) => !entry.date.startsWith('2026-08-'));
  });

  const imports = new reposModule.MockImportRepository(store);
  const people = new reposModule.MockPersonRepository(store);
  const schedules = new reposModule.MockScheduleRepository(store);

  const workbookParser = {
    async parse() {
      throw new Error('workbook parser must not run for image-only import');
    },
  };

  const action = new serviceModule.WorkbookImportFileSelectionAction(
    imports,
    people,
    schedules,
    workbookParser,
    recognizer,
  );

  const imageFile = {
    name: 'synthetic-schedule.png',
    type: 'image/png',
    arrayBuffer: async () => new ArrayBuffer(0),
  };

  const batchId = await action.accept([{ kind: 'IMAGE', file: imageFile }]);
  const batch = await imports.getBatch(batchId);

  expect(batch?.files.length === 1, 'image import file count mismatch');
  expect(batch?.files[0]?.kind === 'IMAGE', 'image import file kind mismatch');
  expect(batch?.files[0]?.status === 'READY', 'image recognizer must mark parsed image READY');
  expect(batch?.detectedPeople.some((person) => person.sourceName === '테스트직원'), 'image import lost detected target');
  const matched = batch?.detectedPeople.find((person) => person.sourceName === '테스트직원');
  expect(matched?.matchedPersonId === 'mock-person-1', 'image import exact-name person matching failed');

  const reviewItems = (batch?.reviewItems ?? []).filter((item) => item.personId === 'mock-person-1');
  expect(reviewItems.length === 5, 'image import target review item count mismatch');
  expect(reviewItems.every((item) => item.resolution === 'NEW'), 'matched image-derived review items must default selected');
  expect(batch?.structure.needsReview === true, 'image-derived batch must force structure review');

  const unseenRecognizer = new imageModule.AdaptiveScheduleImageRecognizer({
    async extract() {
      return unseenLayout;
    },
  });
  const unseenStore = new stateModule.MockStateStore(structuredClone(stateModule.MOCK_FIXTURE));
  unseenStore.mutate((state) => {
    state.people = [{ id: 'mock-person-1', name: '테스트직원', relation: '연인' }];
    state.importBatches = [];
    state.schedules = [];
  });
  const unseenImports = new reposModule.MockImportRepository(unseenStore);
  const unseenAction = new serviceModule.WorkbookImportFileSelectionAction(
    unseenImports,
    new reposModule.MockPersonRepository(unseenStore),
    new reposModule.MockScheduleRepository(unseenStore),
    workbookParser,
    unseenRecognizer,
  );
  const unseenBatchId = await unseenAction.accept([{ kind: 'IMAGE', file: imageFile }]);
  const unseenBatch = await unseenImports.getBatch(unseenBatchId);
  const unseenDetected = unseenBatch?.detectedPeople.find(
    (person) => person.sourceName === unseenSourceName,
  );
  expect(unseenDetected != null, 'unseen OCR row label must reach import review');
  expect(
    unseenDetected?.matchedPersonId == null,
    'unseen OCR row label must not be forced onto an existing registered person',
  );
  const unseenReviewItems = (unseenBatch?.reviewItems ?? []).filter(
    (item) => item.detectedPersonId === unseenDetected?.id,
  );
  expect(unseenReviewItems.length === 5, 'unseen row label review item count mismatch');
  expect(
    unseenDetected?.ignored === true &&
      unseenReviewItems.every((item) => item.personId == null && item.resolution == null),
    'unseen row label must default ignored and remain unresolved until explicitly included',
  );

  const unavailableStore = new stateModule.MockStateStore(structuredClone(stateModule.MOCK_FIXTURE));
  unavailableStore.mutate((state) => { state.importBatches = []; });
  const unavailableAction = new serviceModule.WorkbookImportFileSelectionAction(
    new reposModule.MockImportRepository(unavailableStore),
    new reposModule.MockPersonRepository(unavailableStore),
    new reposModule.MockScheduleRepository(unavailableStore),
    workbookParser,
  );

  let unavailableBlocked = false;
  try {
    await unavailableAction.accept([{ kind: 'IMAGE', file: imageFile }]);
  } catch (error) {
    unavailableBlocked = error instanceof Error &&
      error.message.includes('일정을 인식하지 못했습니다');
  }
  expect(unavailableBlocked, 'runtime without image recognizer must fail closed');
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5V adaptive schedule image layout verification passed');
