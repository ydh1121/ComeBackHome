import {
  BrowserScheduleOcrPreprocessor,
  TesseractJsWorkerFactory,
  TesseractScheduleImageTextExtractor,
} from '../../src/providers/import/TesseractScheduleImageTextExtractor';
import { parseScheduleImageLayout } from '../../src/providers/import/StructuredTableImageScheduleRecognizer';
import { SAME_ORIGIN_TESSERACT_ASSETS } from '../../src/providers/import/ocrRuntimeConfig';

const input = document.querySelector<HTMLInputElement>('#schedule-image');
const runButton = document.querySelector<HTMLButtonElement>('#run');
const clearButton = document.querySelector<HTMLButtonElement>('#clear');
const status = document.querySelector<HTMLElement>('#status');
const summary = document.querySelector<HTMLElement>('#summary');
const parsed = document.querySelector<HTMLElement>('#parsed');
const tokens = document.querySelector<HTMLElement>('#tokens');

if (!input || !runButton || !clearButton || !status || !summary || !parsed || !tokens) {
  throw new Error('OCR evaluation harness DOM is incomplete.');
}

const extractor = new TesseractScheduleImageTextExtractor(
  new TesseractJsWorkerFactory(SAME_ORIGIN_TESSERACT_ASSETS),
  new BrowserScheduleOcrPreprocessor(),
);

function reset(): void {
  input.value = '';
  status.textContent = '대기 중';
  summary.textContent = '아직 실행하지 않았습니다.';
  parsed.textContent = '아직 실행하지 않았습니다.';
  tokens.textContent = '아직 실행하지 않았습니다.';
}

function formatError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

async function runEvaluation(): Promise<void> {
  const file = input.files?.[0];
  if (!file) {
    status.textContent = '이미지를 먼저 선택하세요.';
    return;
  }

  runButton.disabled = true;
  input.disabled = true;
  status.textContent = '로컬 OCR 실행 중…';
  summary.textContent = '처리 중…';
  parsed.textContent = '처리 중…';
  tokens.textContent = '처리 중…';

  const startedAt = performance.now();

  try {
    const layout = await extractor.extract(file);
    const ocrElapsedMs = performance.now() - startedAt;
    const parserStartedAt = performance.now();

    let parserResult: unknown = null;
    let parserError: string | null = null;

    try {
      parserResult = parseScheduleImageLayout(layout);
    } catch (error) {
      parserError = formatError(error);
    }

    const parserElapsedMs = performance.now() - parserStartedAt;
    const confidenceValues = layout.tokens.map((token) => token.confidence);
    const averageConfidence = confidenceValues.length
      ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
      : 0;

    summary.textContent = JSON.stringify({
      source: {
        name: file.name,
        type: file.type,
        bytes: file.size,
      },
      runtime: {
        workerPath: SAME_ORIGIN_TESSERACT_ASSETS.workerPath,
        corePath: SAME_ORIGIN_TESSERACT_ASSETS.corePath,
        langPath: SAME_ORIGIN_TESSERACT_ASSETS.langPath,
        externalImageUpload: 0,
        imagePersistence: 0,
      },
      image: {
        width: layout.width,
        height: layout.height,
      },
      evidence: {
        tokenCount: layout.tokens.length,
        averageConfidence: Number(averageConfidence.toFixed(4)),
      },
      timingMs: {
        ocr: Number(ocrElapsedMs.toFixed(1)),
        parser: Number(parserElapsedMs.toFixed(1)),
        total: Number((performance.now() - startedAt).toFixed(1)),
      },
    }, null, 2);

    parsed.textContent = parserError
      ? JSON.stringify({
          result: 'REVIEW_REQUIRED',
          error: parserError,
        }, null, 2)
      : JSON.stringify({
          result: 'PARSED_REVIEW_REQUIRED',
          parsed: parserResult,
        }, null, 2);

    tokens.textContent = JSON.stringify(layout.tokens, null, 2);
    status.textContent = parserError
      ? 'OCR 완료 · 구조 자동판정 실패 · 수동 검토 필요'
      : 'OCR + adaptive parser 완료 · 검토 필요';
  } catch (error) {
    const message = formatError(error);
    status.textContent = '실패 · 결과를 일정으로 추정하지 않음';
    summary.textContent = JSON.stringify({
      result: 'FAILED_CLOSED',
      error: message,
    }, null, 2);
    parsed.textContent = '생성된 일정 없음';
    tokens.textContent = '신뢰 가능한 OCR evidence 없음';
  } finally {
    runButton.disabled = false;
    input.disabled = false;
  }
}

runButton.addEventListener('click', () => {
  void runEvaluation();
});

clearButton.addEventListener('click', reset);
