import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const reviewSource = await read('../src/pages/ImportReviewPage.tsx');
const matchSource = await read('../src/pages/ImportPersonMatchPage.tsx');
const commitSource = await read('../src/application/use-cases/commitImportReview.ts');

for (const text of [
  'visibleReviewItems.map',
  'const allReviewed',
  "item.resolution === 'SKIP'",
  "item.resolution === 'NEW' && importedTimeComplete(item)",
  'exactDuplicate',
  "item.resolution === 'NEW' ? 'SKIP' : 'NEW'",
  "disabled={!allReviewed || saveState === 'saving'}",
  "disabled={!item.personId || !importedComplete}",
  'services.actions.importReview.setImportedTime',
  'TimeRangeWheelPicker',
]) {
  expect(reviewSource.includes(text), 'multi-item review UI missing ' + text);
}
expect(!reviewSource.includes('batch.reviewItems[0]'), 'review UI must not collapse real import to first item');
expect(!reviewSource.includes('type="time"'), 'import review must not use native time inputs on iPhone');
expect(matchSource.includes('const allResolved'), 'person match completion gate missing');
expect(matchSource.includes('<option value="">연결 안 됨</option>'), 'unmatched person label must be explicit');
expect(matchSource.includes('새 사람으로 등록'), 'detected person create option missing');
expect(matchSource.includes('가져오지 않음'), 'detected person ignore option missing');
expect(matchSource.includes('disabled={!allResolved || includedCount === 0}'), 'person match next CTA must block unresolved/empty imports');
expect(commitSource.includes("Import contains unresolved people."), 'unresolved person commit guard missing');
expect(commitSource.includes("Import contains unreviewed schedules."), 'unreviewed schedule commit guard missing');
expect(commitSource.includes("Import contains incomplete schedule times."), 'incomplete imported time commit guard missing');

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const commitModule = await vite.ssrLoadModule('/src/application/use-cases/commitImportReview.ts');
  const selectionModule = await vite.ssrLoadModule('/src/application/services/WorkbookImportFileSelectionAction.ts');
  const reposModule = await vite.ssrLoadModule('/src/mocks/repositories.ts');
  const stateModule = await vite.ssrLoadModule('/src/mocks/state.ts');

  const selectionStore = new stateModule.MockStateStore(structuredClone(stateModule.MOCK_FIXTURE));
  selectionStore.mutate((state) => {
    state.importBatches = [];
  });
  const selectionImports = new reposModule.MockImportRepository(selectionStore);
  const selectionPeople = new reposModule.MockPersonRepository(selectionStore);
  const selectionSchedules = new reposModule.MockScheduleRepository(selectionStore);
  const selection = new selectionModule.WorkbookImportFileSelectionAction(
    selectionImports,
    selectionPeople,
    selectionSchedules,
    {
      async parse() {
        return {
          detectedPeople: [{ sourceName: '여자친구', confidence: 0.92 }],
          scheduleCandidates: [],
          reviewCandidates: [{
            sourcePersonName: '여자친구',
            date: '2099-01-31',
            start: '09:00',
            end: null,
            sourceRow: 2,
            confidence: 0.91,
          }],
          structure: {
            sheet: '근무표',
            headerRow: 1,
            personColumn: 'A',
            dateColumn: 'B',
            shiftColumn: 'C:D',
            needsReview: true,
          },
          confidence: 0.91,
        };
      },
    },
  );
  const selectionBatchId = await selection.accept([{
    kind: 'WORKBOOK',
    file: {
      name: 'incomplete-review.xlsx',
      async arrayBuffer() { return new ArrayBuffer(0); },
    },
  }]);
  const selectionBatch = await selectionImports.getBatch(selectionBatchId);
  expect(
    selectionBatch?.reviewItems.length === 1 &&
      selectionBatch.reviewItems[0]?.imported.start === '09:00' &&
      selectionBatch.reviewItems[0]?.imported.end == null &&
      selectionBatch.reviewItems[0]?.resolution === 'NEW',
    'one-sided parser review candidate must survive and default selected',
  );

  const store = new stateModule.MockStateStore(structuredClone(stateModule.MOCK_FIXTURE));
  store.mutate((state) => {
    state.schedules = state.schedules.filter((entry) => !['2099-02-01', '2099-02-02'].includes(entry.date));
    state.importBatches = [{
      id: 'phase5q-batch',
      files: [{
        id: 'phase5q-file',
        name: 'phase5q.xlsx',
        kind: 'XLSX',
        progress: 100,
        status: 'READY',
      }],
      detectedPeople: [{
        id: 'phase5q-person',
        sourceName: '여자친구',
        matchedPersonId: 'mock-person-1',
        confidence: 1,
      }],
      structure: {
        sheet: '근무표',
        headerRow: 1,
        personColumn: 'A',
        dateColumn: 'B',
        shiftColumn: 'C:D',
        needsReview: false,
      },
      reviewItems: [
        {
          id: 'phase5q-review-1',
          detectedPersonId: 'phase5q-person',
          personId: 'mock-person-1',
          date: '2099-02-01',
          imported: { start: '09:00', end: '18:00' },
          resolution: null,
        },
        {
          id: 'phase5q-review-2',
          detectedPersonId: 'phase5q-person',
          personId: 'mock-person-1',
          date: '2099-02-02',
          imported: { start: '10:00', end: null },
          resolution: null,
        },
      ],
      committed: false,
    }];
  });

  const imports = new reposModule.MockImportRepository(store);
  const schedules = new reposModule.MockScheduleRepository(store);
  const commit = new commitModule.CommitImportReview(imports, schedules);

  let zeroReviewedBlocked = false;
  try {
    await commit.execute('phase5q-batch');
  } catch (error) {
    zeroReviewedBlocked = error instanceof Error &&
      error.message === 'Import contains unreviewed schedules.';
  }
  expect(zeroReviewedBlocked, 'zero-reviewed batch must be blocked');

  await imports.setResolution('phase5q-batch', 'phase5q-review-1', 'SKIP');
  let partialReviewedBlocked = false;
  try {
    await commit.execute('phase5q-batch');
  } catch (error) {
    partialReviewedBlocked = error instanceof Error &&
      error.message === 'Import contains unreviewed schedules.';
  }
  expect(partialReviewedBlocked, 'partially reviewed batch must remain blocked');
  expect(await schedules.getByDate('mock-person-1', '2099-02-01') === null, 'SKIP review must not mutate first schedule');

  await imports.setResolution('phase5q-batch', 'phase5q-review-2', 'NEW');

  let incompleteBlocked = false;
  try {
    await commit.execute('phase5q-batch');
  } catch (error) {
    incompleteBlocked = error instanceof Error &&
      error.message === 'Import contains incomplete schedule times.';
  }
  expect(incompleteBlocked, 'incomplete NEW schedule must remain blocked');

  await imports.setImportedTime('phase5q-batch', 'phase5q-review-2', 'end', '19:00');
  await commit.execute('phase5q-batch');

  const first = await schedules.getByDate('mock-person-1', '2099-02-01');
  const second = await schedules.getByDate('mock-person-1', '2099-02-02');
  expect(first === null, 'SKIP schedule must remain uncommitted');
  expect(second?.start === '10:00' && second?.end === '19:00', 'fully reviewed second schedule commit mismatch');
  expect((await imports.getBatch('phase5q-batch'))?.committed === true, 'fully reviewed batch not marked committed');

  store.mutate((state) => {
    const batch = state.importBatches[0];
    batch.committed = false;
    batch.reviewItems[0].personId = null;
  });
  let unresolvedBlocked = false;
  try {
    await commit.execute('phase5q-batch');
  } catch (error) {
    unresolvedBlocked = error instanceof Error &&
      error.message === 'Import contains unresolved people.';
  }
  expect(unresolvedBlocked, 'unresolved person must block even a resolved schedule choice');
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5Q explicit multi-item import review verification passed');
