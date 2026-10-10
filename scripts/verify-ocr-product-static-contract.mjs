import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=(name)=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const composition=source('src/app/composition.ts');
const actual=source('src/providers/import/PaddleWeeklyRegionalTextExtractor.ts');
const core=source('src/providers/import/PaddleOnnxRegionalExtractor.js');
const selection=source('src/application/services/WorkbookImportFileSelectionAction.ts');
const review=source('src/pages/ImportReviewPage.tsx');
const api=source('worker/api.ts');
const d1=source('worker/repositories/D1ScheduleRepository.ts');
const httpSchedules=source('src/providers/http/HttpRepositories.ts');
const commitReview=source('src/application/use-cases/commitImportReview.ts');
const migration=source('db/migrations/0008_weekly_ocr_break_minutes.sql');
const workflow=source('.github/workflows/phase5g-local-integration.yml');
const diagnosticWorkflow=source('.github/workflows/ocr-generic-diagnostic.yml');
const stage=source('scripts/stage-weekly-paddle-assets.mjs');
const prepare=source('scripts/prepare-weekly-paddle-assets.mjs');
const packageJson=JSON.parse(source('package.json'));
assert.match(composition,/new Weekly3ColumnScheduleImageRecognizer\(/);
assert.match(composition,/new PaddleWeeklyRegionalTextExtractor\(/);
assert.doesNotMatch(composition,/new StructureFirstScheduleImageRecognizer\(/);
assert.match(composition,/new ReadExcelWorkbookParser\(\)/);
assert.match(actual,/manifestUrl:'\/ocr\/weekly\/integrity\.json'/);
assert.match(actual,/import\('\.\/PaddleOnnxRegionalExtractor\.js'\)/);
assert.match(core,/VERIFIED_MODEL_SHA256/);
assert.match(core,/WEEKLY_PADDLE_WASM_INTEGRITY_MISMATCH/);
assert.match(core,/WEEKLY_PADDLE_DICTIONARY_INTEGRITY_MISMATCH/);
assert.match(stage,/import '\.\/prepare-weekly-paddle-assets\.mjs'/);
assert.match(prepare,/MODEL_SHA/);
assert.match(prepare,/DICT_SHA/);
assert.match(prepare,/92f0b7785e64fc9090106a241cf4c1eb97472824558272751b88a2a4476d3a08/);
assert.match(prepare,/8aa03fad51cd719c83590dfc4d7e3edea6f2a01f07a08fc476250f42322bb403/);
assert.match(prepare,/onnxruntime-web/);
assert.match(prepare,/WEEKLY_PADDLE_STAGED_HASH_MISMATCH/);
assert.match(packageJson.scripts.prebuild,/prepare:weekly-paddle-assets/,
  'Actual production build must stage the pinned weekly Paddle runtime');
assert.match(selection,/breakMinutes/);
assert.match(review,/weekly3ColumnReview \|\| !exactDuplicate\(item\)/);
assert.match(review,/setImportedBreakMinutes/);
assert.match(api,/optionalScheduleBreakMinutes/);
assert.match(d1,/break_minutes/);
assert.match(d1,/WHEN excluded.enabled = 0 THEN NULL/);
assert.match(httpSchedules,/this\.client\.put\('\/schedules\/import'/,
  'Multi-person client must send one atomic import request');
assert.match(commitReview,/await this\.schedules\.upsertMany\(entries\)/,
  'Reviewed people must remain one D1 batch');
assert.match(api,/segments\[1\] === 'schedules'/,
  'Server must expose same-origin atomic import route');
assert.match(api,/Duplicate person\/date in import batch/,
  'Atomic import must reject ambiguous duplicate person/date');
assert.match(api,/Import references unknown person/,
  'Atomic import must reject unresolved people');
assert.match(migration,/ADD COLUMN break_minutes INTEGER/);
assert.match(workflow,/Stage verified Korean ONNX, dictionary and WASM/);
assert.match(workflow,/PRODUCT_REQUIRED_GATE/);
assert.match(workflow,/SHARED_SAFETY_GATE/);
assert.doesNotMatch(workflow,/verify:ocr-real-tesseract-e2e/,
  'Generic 4/5/6-day Tesseract must not remain in the blocking product workflow');
assert.doesNotMatch(workflow,/verify-ocr-detected-engine-comparison/,
  'Generic StructureFirst matrix must not remain in the blocking product workflow');
assert.match(diagnosticWorkflow,/GENERIC_OCR_DIAGNOSTIC/);
assert.match(diagnosticWorkflow,/D-CBH-20261009-OCR-GATE-C-DISPOSITION-001/);
assert.match(diagnosticWorkflow,/verify:ocr-real-tesseract-e2e/);
assert.match(diagnosticWorkflow,/verify-ocr-detected-engine-comparison/);
assert.doesNotMatch(workflow,/continue-on-error:\s*true/);
assert.doesNotMatch(diagnosticWorkflow,/continue-on-error:\s*true/);
console.log('CBH_WEEKLY_PRODUCT_STATIC_SOURCE_CONTRACT_PASS='+JSON.stringify({
  productComposition:'WEEKLY_PADDLE',
  xlsx:'PRESERVED',
  modelIntegrity:'SHA256_PINNED',
  stageSameOrigin:true,
  reviewApprovalRequired:true,
  breakDataPath:'PARSER_TO_HTTP_TO_D1',
  requiredGateClasses:['PRODUCT_REQUIRED_GATE','SHARED_SAFETY_GATE'],
  genericOcrDiagnostic:'RESEARCH_DIAGNOSTIC_NON_BLOCKING_FAIL_PRESERVED',
  sourceOnlyNotRealBrowserE2E:true,
}));
