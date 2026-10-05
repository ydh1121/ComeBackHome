import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createServer as createViteServer } from 'vite';
import {
  buildRowOrientedScheduleLayoutFixture,
  buildScheduleImageLayoutFixture,
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
      error.message === 'Image schedule layout was not recognized confidently.';
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
  expect(reviewItems.every((item) => item.resolution == null), 'image-derived review items must start unreviewed');
  expect(batch?.structure.needsReview === true, 'image-derived batch must force structure review');

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
      error.message === 'No supported import file could be parsed.';
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
