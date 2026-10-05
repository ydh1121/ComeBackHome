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
  'batch.reviewItems.map',
  'const allReviewed',
  'item.personId != null && item.resolution != null',
  "disabled={!allReviewed || saveState === 'saving'}",
  "disabled={!item.existing || !item.personId}",
  "disabled={!item.personId}",
]) {
  expect(reviewSource.includes(text), 'multi-item review UI missing ' + text);
}
expect(!reviewSource.includes('batch.reviewItems[0]'), 'review UI must not collapse real import to first item');
expect(matchSource.includes('const allMatched'), 'person match completion gate missing');
expect(matchSource.includes("matched?.name ?? '연결 안 됨'"), 'unmatched person label must be explicit');
expect(matchSource.includes('disabled={!allMatched}'), 'person match next CTA must block unresolved people');
expect(commitSource.includes("Import contains unresolved people."), 'unresolved person commit guard missing');
expect(commitSource.includes("Import contains unreviewed schedules."), 'unreviewed schedule commit guard missing');

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const commitModule = await vite.ssrLoadModule('/src/application/use-cases/commitImportReview.ts');
  const reposModule = await vite.ssrLoadModule('/src/mocks/repositories.ts');
  const stateModule = await vite.ssrLoadModule('/src/mocks/state.ts');

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
          imported: { start: '10:00', end: '19:00' },
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

  await imports.setResolution('phase5q-batch', 'phase5q-review-1', 'NEW');
  let partialReviewedBlocked = false;
  try {
    await commit.execute('phase5q-batch');
  } catch (error) {
    partialReviewedBlocked = error instanceof Error &&
      error.message === 'Import contains unreviewed schedules.';
  }
  expect(partialReviewedBlocked, 'partially reviewed batch must remain blocked');
  expect(await schedules.getByDate('mock-person-1', '2099-02-01') === null, 'partial review must not mutate first schedule');

  await imports.setResolution('phase5q-batch', 'phase5q-review-2', 'NEW');
  await commit.execute('phase5q-batch');

  const first = await schedules.getByDate('mock-person-1', '2099-02-01');
  const second = await schedules.getByDate('mock-person-1', '2099-02-02');
  expect(first?.start === '09:00' && first?.end === '18:00', 'fully reviewed first schedule commit mismatch');
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
