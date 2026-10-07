import {
  BrowserScheduleOcrPreprocessor,
  TesseractJsWorkerFactory,
  TesseractScheduleImageTextExtractor,
} from '../../src/providers/import/TesseractScheduleImageTextExtractor';
import { BrowserScheduleTableStructureDetector } from '../../src/providers/import/ScheduleTableStructureDetector';
import { StructureFirstScheduleImageRecognizer } from '../../src/providers/import/StructureFirstScheduleImageRecognizer';
import { SAME_ORIGIN_TESSERACT_ASSETS } from '../../src/providers/import/ocrRuntimeConfig';

const input = document.querySelector<HTMLInputElement>('#schedule-image');
const runButton = document.querySelector<HTMLButtonElement>('#run');
const copyAllButton = document.querySelector<HTMLButtonElement>('#copy-all');
const saveAllButton = document.querySelector<HTMLButtonElement>('#save-all');
const clearButton = document.querySelector<HTMLButtonElement>('#clear');
const status = document.querySelector<HTMLElement>('#status');
const selection = document.querySelector<HTMLElement>('#selection');
const summary = document.querySelector<HTMLElement>('#summary');
const parsed = document.querySelector<HTMLElement>('#parsed');
const tokens = document.querySelector<HTMLElement>('#tokens');

if (
  !input ||
  !runButton ||
  !copyAllButton ||
  !saveAllButton ||
  !clearButton ||
  !status ||
  !selection ||
  !summary ||
  !parsed ||
  !tokens
) {
  throw new Error('OCR evaluation harness DOM is incomplete.');
}

const extractor = new TesseractScheduleImageTextExtractor(
  new TesseractJsWorkerFactory(SAME_ORIGIN_TESSERACT_ASSETS),
  new BrowserScheduleOcrPreprocessor(),
  { useStructureFirstMode: true },
);
const recognizer = new StructureFirstScheduleImageRecognizer(
  new BrowserScheduleTableStructureDetector(),
  extractor,
);

interface FileEvaluationResult {
  source: {
    name: string;
    type: string;
    bytes: number;
  };
  runtime: {
    workerPath: string;
    corePath: string;
    langPath: string;
    externalImageUpload: 0;
    imagePersistence: 0;
  };
  structure?: {
    imageWidth: number;
    imageHeight: number;
    confidence: number;
    evidence: unknown;
    detectedRowBands: number;
    detectedColumnBands: number;
  };
  matrix?: {
    rows: unknown[];
    dates: unknown[];
    cells: unknown[];
    workCount: number;
    offCount: number;
    incompleteCount: number;
    unreadableCount: number;
  };
  timingMs: {
    preprocessing?: number;
    structureDetection?: number;
    initialOcr?: number;
    regionalOcr?: number;
    total: number;
  };
  roiCount?: number;
  initialOcrTokenCount?: number;
  parser:
    | {
        result: 'PARSED_REVIEW_REQUIRED';
        parsed: unknown;
      }
    | {
        result: 'FAILED_CLOSED';
        error: string;
      };
  regionalOcr: unknown[];
}

interface EvaluationBundle {
  schema: 'comebackhome-private-ocr-eval/v3';
  generatedAt: string;
  runtime: {
    workerPath: string;
    corePath: string;
    langPath: string;
    externalImageUpload: 0;
    sourceImagePersistence: 0;
    derivedEvidenceExport: 'user-triggered-only';
    recognitionArchitecture: 'structure-first';
  };
  fileCount: number;
  files: FileEvaluationResult[];
}

let latestBundle: EvaluationBundle | null = null;

function runtimeMetadata(): FileEvaluationResult['runtime'] {
  return {
    workerPath: SAME_ORIGIN_TESSERACT_ASSETS.workerPath,
    corePath: SAME_ORIGIN_TESSERACT_ASSETS.corePath,
    langPath: SAME_ORIGIN_TESSERACT_ASSETS.langPath,
    externalImageUpload: 0,
    imagePersistence: 0,
  };
}

function updateSelection(): void {
  const count = input.files?.length ?? 0;
  selection.textContent = `선택된 이미지 ${count}개`;
}

function reset(): void {
  input.value = '';
  latestBundle = null;
  status.textContent = '대기 중';
  selection.textContent = '선택된 이미지 0개';
  summary.textContent = '아직 실행하지 않았습니다.';
  parsed.textContent = '아직 실행하지 않았습니다.';
  tokens.textContent = '아직 실행하지 않았습니다.';
  copyAllButton.disabled = true;
  saveAllButton.disabled = true;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function bundleText(): string {
  if (!latestBundle) throw new Error('복사할 QA 결과가 없습니다.');
  return JSON.stringify(latestBundle, null, 2);
}

function cellStateCounts(parsedImport: any) {
  const review = Array.isArray(parsedImport?.reviewCandidates)
    ? parsedImport.reviewCandidates
    : [];
  return {
    workCount: Array.isArray(parsedImport?.scheduleCandidates)
      ? parsedImport.scheduleCandidates.length
      : 0,
    offCount: review.filter((item: any) => item?.recognitionState === 'OFF').length,
    incompleteCount: review.filter((item: any) => item?.recognitionState === 'INCOMPLETE').length,
    unreadableCount: review.filter((item: any) => item?.recognitionState === 'UNREADABLE').length,
  };
}

function renderBundle(bundle: EvaluationBundle): void {
  summary.textContent = JSON.stringify({
    schema: bundle.schema,
    generatedAt: bundle.generatedAt,
    runtime: bundle.runtime,
    fileCount: bundle.fileCount,
    files: bundle.files.map((item) => ({
      source: item.source,
      structure: item.structure,
      matrix: item.matrix
        ? {
            rowCount: item.matrix.rows.length,
            dateCount: item.matrix.dates.length,
            cellCount: item.matrix.cells.length,
            workCount: item.matrix.workCount,
            offCount: item.matrix.offCount,
            incompleteCount: item.matrix.incompleteCount,
            unreadableCount: item.matrix.unreadableCount,
          }
        : null,
      timingMs: item.timingMs,
      roiCount: item.roiCount,
      parserResult: item.parser.result,
    })),
  }, null, 2);

  parsed.textContent = JSON.stringify(
    bundle.files.map((item) => ({
      sourceName: item.source.name,
      parser: item.parser,
      matrix: item.matrix,
    })),
    null,
    2,
  );

  tokens.textContent = JSON.stringify(
    bundle.files.map((item) => ({
      sourceName: item.source.name,
      initialOcrTokenCount: item.initialOcrTokenCount,
      regionalOcr: item.regionalOcr,
    })),
    null,
    2,
  );
}

async function evaluateFile(file: File): Promise<FileEvaluationResult> {
  const startedAt = performance.now();
  const runtime = runtimeMetadata();

  try {
    const diagnostic = await recognizer.evaluate(file);
    const counts = cellStateCounts(diagnostic.parsed);
    return {
      source: {
        name: file.name,
        type: file.type,
        bytes: file.size,
      },
      runtime,
      structure: {
        imageWidth: diagnostic.detection.structure.imageWidth,
        imageHeight: diagnostic.detection.structure.imageHeight,
        confidence: diagnostic.detection.structure.confidence,
        evidence: diagnostic.detection.structure.evidence,
        detectedRowBands: diagnostic.detection.structure.rowBands.length,
        detectedColumnBands: diagnostic.detection.structure.columnBands.length,
      },
      matrix: {
        rows: diagnostic.matrix.rows,
        dates: diagnostic.matrix.dates,
        cells: diagnostic.matrix.cells,
        ...counts,
      },
      timingMs: diagnostic.timingMs,
      roiCount: diagnostic.roiCount,
      initialOcrTokenCount: diagnostic.layoutTokenCount,
      parser: {
        result: 'PARSED_REVIEW_REQUIRED',
        parsed: diagnostic.parsed,
      },
      regionalOcr: diagnostic.regionResults,
    };
  } catch (error) {
    return {
      source: {
        name: file.name,
        type: file.type,
        bytes: file.size,
      },
      runtime,
      timingMs: {
        total: Number((performance.now() - startedAt).toFixed(1)),
      },
      parser: {
        result: 'FAILED_CLOSED',
        error: formatError(error),
      },
      regionalOcr: [],
    };
  }
}

async function runEvaluation(): Promise<void> {
  const files = Array.from(input.files ?? []);
  if (!files.length) {
    status.textContent = '이미지를 먼저 선택하세요.';
    return;
  }

  runButton.disabled = true;
  input.disabled = true;
  copyAllButton.disabled = true;
  saveAllButton.disabled = true;
  latestBundle = null;
  summary.textContent = '처리 중…';
  parsed.textContent = '처리 중…';
  tokens.textContent = '처리 중…';

  const results: FileEvaluationResult[] = [];

  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      status.textContent = `구조 복원 + 로컬 OCR 실행 중… ${index + 1}/${files.length} · ${file.name}`;
      results.push(await evaluateFile(file));
    }

    latestBundle = {
      schema: 'comebackhome-private-ocr-eval/v3',
      generatedAt: new Date().toISOString(),
      runtime: {
        workerPath: SAME_ORIGIN_TESSERACT_ASSETS.workerPath,
        corePath: SAME_ORIGIN_TESSERACT_ASSETS.corePath,
        langPath: SAME_ORIGIN_TESSERACT_ASSETS.langPath,
        externalImageUpload: 0,
        sourceImagePersistence: 0,
        derivedEvidenceExport: 'user-triggered-only',
        recognitionArchitecture: 'structure-first',
      },
      fileCount: results.length,
      files: results,
    };

    renderBundle(latestBundle);
    copyAllButton.disabled = false;
    saveAllButton.disabled = false;

    const parsedCount = results.filter((item) => item.parser.result === 'PARSED_REVIEW_REQUIRED').length;
    const failedCount = results.length - parsedCount;
    status.textContent =
      `전체 완료 · ${results.length}개 · parsed ${parsedCount} · failed ${failedCount}`;
  } finally {
    runButton.disabled = false;
    input.disabled = false;
  }
}

async function copyAllResults(): Promise<void> {
  const text = bundleText();
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = '전체 QA 결과를 클립보드에 복사했습니다.';
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    if (!copied) throw new Error('클립보드 복사에 실패했습니다. JSON 저장 버튼을 사용하세요.');
    status.textContent = '전체 QA 결과를 클립보드에 복사했습니다.';
  }
}

function saveAllResults(): void {
  const text = bundleText();
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  anchor.href = url;
  anchor.download = `ComeBackHome-OCR-QA-${timestamp}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  status.textContent = '전체 QA 결과 JSON을 저장했습니다.';
}

input.addEventListener('change', updateSelection);
runButton.addEventListener('click', () => { void runEvaluation(); });
copyAllButton.addEventListener('click', () => {
  void copyAllResults().catch((error) => { status.textContent = formatError(error); });
});
saveAllButton.addEventListener('click', () => {
  try { saveAllResults(); } catch (error) { status.textContent = formatError(error); }
});
clearButton.addEventListener('click', reset);
