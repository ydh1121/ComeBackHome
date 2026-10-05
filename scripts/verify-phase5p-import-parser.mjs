import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { SAMPLE_IMPORT_WORKBOOK_BASE64 } from '../test/fixtures/import/sample-workbook-base64.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

function workbookArrayBuffer() {
  const bytes = Buffer.from(SAMPLE_IMPORT_WORKBOOK_BASE64, 'base64');
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const parserModule = await vite.ssrLoadModule('/src/providers/import/ReadExcelWorkbookParser.ts');
  const serviceModule = await vite.ssrLoadModule('/src/application/services/WorkbookImportFileSelectionAction.ts');
  const commitModule = await vite.ssrLoadModule('/src/application/use-cases/commitImportReview.ts');
  const reposModule = await vite.ssrLoadModule('/src/mocks/repositories.ts');
  const stateModule = await vite.ssrLoadModule('/src/mocks/state.ts');

  const parser = new parserModule.ReadExcelWorkbookParser();
  const parsed = await parser.parse(workbookArrayBuffer());

  expect(parsed.structure.sheet === '근무표', 'actual XLSX sheet name mismatch');
  expect(parsed.structure.headerRow === 1, 'actual XLSX header row mismatch');
  expect(parsed.structure.personColumn === 'A', 'actual XLSX person column mismatch');
  expect(parsed.structure.dateColumn === 'B', 'actual XLSX date column mismatch');
  expect(parsed.structure.shiftColumn === 'C:D', 'actual XLSX shift columns mismatch');
  expect(parsed.detectedPeople.length === 1, 'actual XLSX detected-person count mismatch');
  expect(parsed.detectedPeople[0]?.sourceName === '여자친구', 'actual XLSX detected person mismatch');
  expect(parsed.scheduleCandidates.length === 2, 'actual XLSX schedule candidate count mismatch');
  expect(parsed.scheduleCandidates[0]?.date === '2099-01-04', 'actual XLSX first date mismatch');
  expect(parsed.scheduleCandidates[0]?.start === '09:00', 'actual XLSX first start mismatch');
  expect(parsed.scheduleCandidates[0]?.end === '18:00', 'actual XLSX first end mismatch');
  expect(parsed.scheduleCandidates[1]?.start === '10:30', 'actual XLSX second start mismatch');
  expect(parsed.scheduleCandidates[1]?.end === '19:30', 'actual XLSX second end mismatch');

  const combined = parserModule.parseWorkbookSheets([{
    sheet: '교대',
    data: [
      ['성명', '근무일', '근무시간'],
      ['여자친구', '2099-01-06', '09:00~18:00'],
      ['김하나', '2099-01-07', '오전 10:30-오후 7:30'],
    ],
  }]);
  expect(combined.detectedPeople.length === 2, 'combined-shift multi-person detection mismatch');
  expect(combined.scheduleCandidates.length === 2, 'combined-shift candidate count mismatch');
  expect(combined.structure.shiftColumn === 'C', 'combined-shift column mapping mismatch');
  expect(combined.scheduleCandidates[1]?.start === '10:30', 'Korean AM start parsing mismatch');
  expect(combined.scheduleCandidates[1]?.end === '19:30', 'Korean PM end parsing mismatch');

  const store = new stateModule.MockStateStore(structuredClone(stateModule.MOCK_FIXTURE));
  store.mutate((state) => {
    state.importBatches = [];
  });

  const imports = new reposModule.MockImportRepository(store);
  const people = new reposModule.MockPersonRepository(store);
  const schedules = new reposModule.MockScheduleRepository(store);
  const action = new serviceModule.WorkbookImportFileSelectionAction(
    imports,
    people,
    schedules,
    parser,
  );

  const workbookFile = {
    name: '근무표.xlsx',
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    arrayBuffer: async () => workbookArrayBuffer(),
  };
  const imageFile = {
    name: '근무표.png',
    type: 'image/png',
    arrayBuffer: async () => new ArrayBuffer(0),
  };

  const batchId = await action.accept([
    { kind: 'WORKBOOK', file: workbookFile },
    { kind: 'IMAGE', file: imageFile },
  ]);
  const batch = await imports.getBatch(batchId);

  expect(batch?.files.length === 2, 'import batch file count mismatch');
  expect(batch?.files[0]?.status === 'READY', 'workbook file status must be READY');
  expect(batch?.files[1]?.status === 'ERROR', 'image file must remain explicit ERROR until recognizer exists');
  expect(batch?.detectedPeople.length === 1, 'parsed batch person count mismatch');
  expect(batch?.detectedPeople[0]?.matchedPersonId === 'mock-person-1', 'exact-name person auto-match failed');
  expect(batch?.reviewItems.length === 2, 'parsed batch review item count mismatch');
  expect(batch?.reviewItems.every((item) => item.personId === 'mock-person-1'), 'review person ownership mismatch');
  expect(batch?.reviewItems.every((item) => item.detectedPersonId === batch.detectedPeople[0]?.id), 'review detected-person linkage mismatch');

  const commit = new commitModule.CommitImportReview(imports, schedules);
  const detectedId = batch?.detectedPeople[0]?.id;
  if (detectedId) await imports.setDetectedPersonMatch(batchId, detectedId, null);

  let unresolvedBlocked = false;
  try {
    await commit.execute(batchId);
  } catch (error) {
    unresolvedBlocked = error instanceof Error && error.message === 'Import contains unresolved people.';
  }
  expect(unresolvedBlocked, 'unresolved import person must block schedule commit');

  if (detectedId) await imports.setDetectedPersonMatch(batchId, detectedId, 'mock-person-1');
  const rematched = await imports.getBatch(batchId);
  expect(rematched?.reviewItems.every((item) => item.personId === 'mock-person-1'), 'person rematch did not propagate to review items');

  await commit.execute(batchId);
  const firstSaved = await schedules.getByDate('mock-person-1', '2099-01-04');
  const secondSaved = await schedules.getByDate('mock-person-1', '2099-01-05');
  expect(firstSaved?.start === '09:00' && firstSaved?.end === '18:00', 'first parsed schedule commit mismatch');
  expect(secondSaved?.start === '10:30' && secondSaved?.end === '19:30', 'second parsed schedule commit mismatch');
  expect((await imports.getBatch(batchId))?.committed === true, 'parsed import batch was not marked committed');

  const nextBatch = await imports.getCurrentBatch();
  expect(nextBatch === null, 'committed import batch must not remain current');
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5P real workbook import parser verification passed');
