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
const migration=source('db/migrations/0008_weekly_ocr_break_minutes.sql');
const workflow=source('.github/workflows/phase5g-local-integration.yml');
const stage=source('scripts/stage-weekly-paddle-assets.mjs');
assert.match(composition,/new Weekly3ColumnScheduleImageRecognizer\(/);
assert.match(composition,/new PaddleWeeklyRegionalTextExtractor\(/);
assert.doesNotMatch(composition,/new StructureFirstScheduleImageRecognizer\(/);
assert.match(composition,/new ReadExcelWorkbookParser\(\)/);
assert.match(actual,/manifestUrl:'\/ocr\/weekly\/integrity\.json'/);
assert.match(actual,/import\('\.\/PaddleOnnxRegionalExtractor\.js'\)/);
assert.match(core,/VERIFIED_MODEL_SHA256/);
assert.match(core,/WEEKLY_PADDLE_WASM_INTEGRITY_MISMATCH/);
assert.match(core,/WEEKLY_PADDLE_DICTIONARY_INTEGRITY_MISMATCH/);
assert.match(stage,/OFFICIAL_HASH/);
assert.match(selection,/breakMinutes/);
assert.match(review,/weekly3ColumnReview \|\| !exactDuplicate\(item\)/);
assert.match(review,/setImportedBreakMinutes/);
assert.match(api,/optionalScheduleBreakMinutes/);
assert.match(d1,/break_minutes/);
assert.match(d1,/WHEN excluded.enabled = 0 THEN NULL/);
assert.match(migration,/ADD COLUMN break_minutes INTEGER/);
assert.match(workflow,/Stage verified Korean ONNX, dictionary and WASM/);
assert.match(workflow,/legacy generic|Legacy general 4-6d/i);
assert.doesNotMatch(workflow,/continue-on-error:\s*true/);
console.log('CBH_WEEKLY_PRODUCT_STATIC_SOURCE_CONTRACT_PASS='+JSON.stringify({
  productComposition:'WEEKLY_PADDLE',
  xlsx:'PRESERVED',
  modelIntegrity:'SHA256_PINNED',
  stageSameOrigin:true,
  reviewApprovalRequired:true,
  breakDataPath:'PARSER_TO_HTTP_TO_D1',
  legacyGenericTesseractCI:'STILL_BLOCKING',
  sourceOnlyNotRealBrowserE2E:true,
}));
