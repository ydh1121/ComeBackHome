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
const schedulePage = await read('../src/pages/SchedulePage.tsx');
const browserImports = await read('../src/providers/browser/BrowserImportRepository.ts');

for (const text of ['type="file"','근무표 이미지 추가','엑셀 파일 가져오기','인식 결과 보기','services.actions.importFiles.accept']) {
  if (!root.includes(text)) failures.push('root missing ' + text);
}
if (people.includes('services.actions.people.create')) failures.push('new employees must not be inserted before final schedule approval');
for (const text of ['사람 연결','인식 신뢰도','연결 안 됨','신규 직원으로 최종 승인 시 등록','가져오지 않음','setPendingNewPerson','setPersonIgnored','setPersonMatch']) {
  if (!people.includes(text)) failures.push('people missing ' + text);
}
for (const text of ['표 구조 확인','머리글 행','근무시간 열','자동 인식이 확실하지 않을 때만']) {
  if (!structure.includes(text)) failures.push('structure missing ' + text);
}
for (const text of ['일정 확인','가져오기','visibleReviewItems.map','allReviewed','exactDuplicate','SKIP','services.actions.importReview.setResolution','commitImportReview.execute']) {
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
// The real IMAGE path intentionally uses the current workplace 7x3 Paddle
// adapter. StructureFirst is a legacy general OCR path, not a valid product
// requirement. Keep independent XLSX, people, review, and commit guards below.
if (!composition.includes('new Weekly3ColumnScheduleImageRecognizer'))
  failures.push('weekly 7x3 production image recognizer not composed');
if (!composition.includes('new PaddleWeeklyRegionalTextExtractor'))
  failures.push('real Paddle regional OCR adapter not composed');
if (!composition.includes('new TesseractScheduleImageTextExtractor'))
  failures.push('Tesseract header/geometry recognizer not composed');
if (composition.includes('new StructureFirstScheduleImageRecognizer'))
  failures.push('legacy structure-first image recognizer is still in product composition');
if (!composition.includes('new BrowserScheduleTableStructureDetector')) failures.push('pixel table structure detector not composed');
if (!composition.includes('new TesseractScheduleImageTextExtractor')) failures.push('production OCR extractor not composed');
if (!composition.includes('new BrowserImportRepository')) failures.push('production import repository not composed');
if (!browserImports.includes("STORAGE_KEY = 'cbh:import-batches:v2'")) failures.push('browser import persistence version missing');
if (!browserImports.includes("LEGACY_STORAGE_KEYS = ['cbh:import-batches:v1']")) failures.push('legacy import storage cleanup missing');
if (!browserImports.includes('this.state.batches = []')) failures.push('new upload must hard reset all prior browser import batches');
if (!schedulePage.includes("navigate('/import')") || !schedulePage.includes('근무표 이미지 가져오기')) failures.push('schedule-to-image-import entry missing');
if (!commit.includes('await this.schedules.upsertMany(entries)')) failures.push('multi-person schedule atomic batch boundary missing');
if (!commit.includes('Import contains unresolved people.')) failures.push('unresolved-person commit guard missing');
if (!commit.includes('ignoredDetectedIds') || !commit.includes('includedItems')) failures.push('ignored roster people must be excluded from commit');
if (!review.includes('visibleReviewItems') || !review.includes('ignoredDetectedIds')) failures.push('ignored roster people must be excluded from review');
if (!commit.includes("item.resolution === 'KEEP'") || !commit.includes("item.resolution === 'SKIP'")) failures.push('KEEP/SKIP commit rule missing');
if (!commit.includes('item.imported.start')) failures.push('NEW commit rule missing');
if (!composition.includes('new ReadExcelWorkbookParser()'))
  failures.push('XLSX import cannot be removed by Paddle composition');
if (!commit.includes('Import contains unreviewed schedules.'))
  failures.push('unreviewed image cell must never reach schedule storage');
if (!commit.includes('Import contains unreviewed break minutes.'))
  failures.push('unreadable non-empty break must require manual correction');
if (!review.includes('weekly3ColumnReview || !exactDuplicate(item)'))
  failures.push('weekly OCR rows may not be hidden as duplicates before review');
if (!review.includes('setImportedBreakMinutes'))
  failures.push('weekly break correction action missing');
if (!browserImports.includes('item.resolution = null'))
  failures.push('review edits must revoke previous approval');
if (!css.includes('.import-page .upload')) failures.push('upload style missing');
if (!css.includes('.import-page .review-choice')) failures.push('review style missing');
if (!root.includes('import-file-diagnostic')) failures.push('failed OCR diagnostic rendering missing');

for (const [name, source] of [['root', root], ['people', people], ['structure', structure], ['review', review]]) {
  if (source.includes('/mocks/') || source.includes('/providers/')) failures.push(name + ' imports infrastructure');
  if (source.includes('contracts/repositories')) failures.push(name + ' imports repositories');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 4C import workflow verification passed');
