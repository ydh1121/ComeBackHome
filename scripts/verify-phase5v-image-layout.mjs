import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { buildScheduleImageLayoutFixture } from '../test/fixtures/import/sample-image-layout.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

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

  const layout = buildScheduleImageLayoutFixture();
  const parsed = imageModule.parseScheduleImageLayout(layout);

  expect(parsed.structure.sheet === '이미지 근무표', 'image structure label mismatch');
  expect(parsed.structure.needsReview === true, 'image recognition must always require review');
  expect(parsed.structure.personColumn === '좌측 이름열', 'image person-band structure mismatch');
  expect(parsed.detectedPeople.length === 6, 'image person row count mismatch');
  expect(parsed.detectedPeople.some((person) => person.sourceName === '테스트직원'), 'synthetic target person not detected');

  const target = parsed.scheduleCandidates.filter((item) => item.sourcePersonName === '테스트직원');
  expect(target.length === 5, 'target image schedule candidate count mismatch');

  const expected = [
    ['2026-08-18', '12:00', '23:30'],
    ['2026-08-20', '12:00', '23:30'],
    ['2026-08-21', '11:00', '23:30'],
    ['2026-08-22', '10:30', '20:30'],
    ['2026-08-23', '10:30', '20:00'],
  ];

  expected.forEach(([date, start, end]) => {
    const item = target.find((candidate) => candidate.date === date);
    expect(item?.start === start && item?.end === end, 'target image schedule mismatch for ' + date);
  });

  expect(!target.some((item) => item.date === '2026-08-17'), 'blank/off Monday must not create schedule');
  expect(!target.some((item) => item.date === '2026-08-19'), 'blank/off Wednesday must not create schedule');
  expect(!parsed.scheduleCandidates.some((item) => item.start === '17:30' || item.end === '17:30'), 'red note time leaked into schedule data');

  const recognizer = new imageModule.StructuredTableImageScheduleRecognizer({
    async extract() {
      return buildScheduleImageLayoutFixture();
    },
  });

  const direct = await recognizer.parse({
    name: 'synthetic-schedule.png',
    type: 'image/png',
  });
  expect(direct.scheduleCandidates.length === parsed.scheduleCandidates.length, 'recognizer/extractor composition changed parsed output');

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

console.log('phase 5V structured schedule image layout verification passed');
