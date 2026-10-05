import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const failures = [];
const root = await read('../src/pages/ImportPage.tsx');
const people = await read('../src/pages/ImportPersonMatchPage.tsx');
const structure = await read('../src/pages/ImportStructurePage.tsx');
const review = await read('../src/pages/ImportReviewPage.tsx');
const css = await read('../src/pages/import-page.css');
const router = await read('../src/app/router.tsx');
const runtime = await read('../src/application/contracts/runtime.ts');
const composition = await read('../src/app/composition.ts');
const commit = await read('../src/application/use-cases/commitImportReview.ts');

for (const text of ['type="file"','엑셀 또는 이미지','인식 결과 보기','services.actions.importFiles.accept']) {
  if (!root.includes(text)) failures.push('root missing ' + text);
}
for (const text of ['사람 연결','인식 신뢰도','새 사람','services.actions.importMatch.cyclePersonMatch']) {
  if (!people.includes(text)) failures.push('people missing ' + text);
}
for (const text of ['표 구조 확인','머리글 행','근무시간 열','자동 인식이 확실하지 않을 때만']) {
  if (!structure.includes(text)) failures.push('structure missing ' + text);
}
for (const text of ['일정 확인','기존 일정','가져온 일정','services.actions.importReview.setResolution','commitImportReview.execute']) {
  if (!review.includes(text)) failures.push('review missing ' + text);
}
for (const path of ['/import', '/import/:batchId/people', '/import/:batchId/structure', '/import/:batchId/review']) {
  if (!router.includes("'" + path + "'")) failures.push('route missing ' + path);
}
if (!runtime.includes('importFiles: ImportFileSelectionAction')) failures.push('file action missing');
if (!runtime.includes('importMatch: ImportMatchActions')) failures.push('match action missing');
if (!runtime.includes('importReview: ImportReviewActions')) failures.push('review action missing');
if (!composition.includes('new WorkbookImportFileSelectionAction')) failures.push('real workbook file action not composed');
if (!composition.includes('new ReadExcelWorkbookParser')) failures.push('real workbook parser not composed');
if (!commit.includes('schedules.upsertMany(entries)')) failures.push('schedule batch boundary missing');
if (!commit.includes('Import contains unresolved people.')) failures.push('unresolved-person commit guard missing');
if (!commit.includes("item.resolution === 'KEEP'")) failures.push('KEEP commit rule missing');
if (!commit.includes('item.imported.start')) failures.push('NEW commit rule missing');
if (!css.includes('.import-page .upload')) failures.push('upload style missing');
if (!css.includes('.import-page .review-choice')) failures.push('review style missing');

for (const [name, source] of [['root', root], ['people', people], ['structure', structure], ['review', review]]) {
  if (source.includes('/mocks/') || source.includes('/providers/')) failures.push(name + ' imports infrastructure');
  if (source.includes('contracts/repositories')) failures.push(name + ' imports repositories');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 4C import workflow verification passed');
