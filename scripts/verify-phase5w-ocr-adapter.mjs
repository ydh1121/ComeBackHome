import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const extractorSource = await readFile(
  new URL('../src/providers/import/TesseractScheduleImageTextExtractor.ts', import.meta.url),
  'utf8',
);
const compositionSource = await readFile(
  new URL('../src/app/composition.ts', import.meta.url),
  'utf8',
);

for (const text of [
  "this.languages = options.languages ?? ['kor', 'eng']",
  'tessedit_pageseg_mode',
  "tessedit_char_whitelist: '0123456789.,:/-'",
  '{ text: true, blocks: true }',
  'await worker.terminate()',
  'must be a same-origin root-relative path',
]) {
  expect(extractorSource.includes(text), 'OCR adapter source missing ' + text);
}
expect(
  !compositionSource.includes('TesseractScheduleImageTextExtractor'),
  'Phase5W prototype must not be active in production composition',
);
expect(
  !extractorSource.includes('https://cdn.'),
  'OCR adapter must not contain default CDN runtime paths',
);
expect(
  !extractorSource.includes('http://') && !extractorSource.includes('https://'),
  'OCR adapter must not contain external OCR/runtime URLs',
);

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const module = await vite.ssrLoadModule('/src/providers/import/TesseractScheduleImageTextExtractor.ts');

  let externalRejected = false;
  try {
    new module.TesseractJsWorkerFactory({
      workerPath: 'https://cdn.example/worker.js',
      corePath: '/ocr/core/',
      langPath: '/ocr/lang/',
    });
  } catch (error) {
    externalRejected = error instanceof Error &&
      error.message.includes('same-origin root-relative path');
  }
  expect(externalRejected, 'external Tesseract worker path must fail closed');

  const localFactory = new module.TesseractJsWorkerFactory({
    workerPath: '/ocr/tesseract/worker.min.js',
    corePath: '/ocr/tesseract-core/',
    langPath: '/ocr/tessdata/',
  });
  expect(localFactory != null, 'same-origin Tesseract asset paths must be accepted');

  const parameterCalls = [];
  const recognizeCalls = [];
  let terminated = 0;
  let createdLanguages = null;

  const word = (text, confidence, x0, y0, x1, y1) => ({
    text,
    confidence,
    bbox: { x0, y0, x1, y1 },
  });
  const page = (words) => ({
    blocks: [{
      paragraphs: [{
        lines: [{ words }],
      }],
    }],
  });

  const generalWords = [
    word('2026-08-18', 96, 200, 30, 400, 70),
    word('출근', 91, 180, 90, 260, 130),
    word('퇴근', 93, 340, 90, 420, 130),
    word('테스트직원', 95, 20, 150, 150, 190),
    word('12', 92, 190, 150, 240, 190),
    word('235', 92, 350, 150, 420, 190),
    word('노트', 82, 500, 60, 580, 100),
  ];

  const numericWords = [
    word('2026-08-18', 88, 200, 30, 400, 70),
    word('12', 90, 190, 150, 240, 190),
    word('23.5', 84, 350, 150, 420, 190),
    word('17.5', 75, 510, 60, 580, 100),
  ];

  const worker = {
    async setParameters(params) {
      parameterCalls.push(structuredClone(params));
    },
    async recognize(_image, options, output) {
      recognizeCalls.push({ options: structuredClone(options), output: structuredClone(output) });
      const data = recognizeCalls.length === 1 ? page(generalWords) : page(numericWords);
      return { data };
    },
    async terminate() {
      terminated += 1;
    },
  };

  const factory = {
    async create(languages) {
      createdLanguages = [...languages];
      return worker;
    },
  };

  const preprocessor = {
    async prepare(file) {
      return {
        image: file,
        sourceWidth: 1000,
        sourceHeight: 200,
        rasterWidth: 2000,
        rasterHeight: 400,
      };
    },
  };

  const extractor = new module.TesseractScheduleImageTextExtractor(
    factory,
    preprocessor,
    { minimumConfidence: 0.18 },
  );

  const result = await extractor.extract({
    name: 'private-sample.png',
    type: 'image/png',
  });

  expect(JSON.stringify(createdLanguages) === JSON.stringify(['kor', 'eng']), 'OCR languages must default to kor+eng');
  expect(parameterCalls.length === 2, 'OCR must run two parameterized passes');
  expect(recognizeCalls.length === 2, 'OCR must run general + numeric recognition');
  expect(recognizeCalls.every((call) => call.output?.blocks === true), 'OCR passes must request bbox-capable blocks');
  expect(
    parameterCalls[1]?.tessedit_char_whitelist === '0123456789.,:/-',
    'numeric OCR pass whitelist mismatch',
  );
  expect(terminated === 1, 'OCR worker must terminate exactly once');

  expect(result.width === 1000 && result.height === 200, 'OCR output dimensions must use source image coordinates');
  const person = result.tokens.find((token) => token.text === '테스트직원');
  expect(person?.x === 10 && person?.y === 75, 'scaled OCR bbox was not mapped back to source coordinates');

  const end = result.tokens.find((token) => token.text === '23.5');
  expect(end != null, 'numeric pass explicit decimal token must survive merge');
  expect(!result.tokens.some((token) => token.text === '235'), 'overlapping punctuation-losing token must be replaced');
  expect(end?.x === 175 && end?.width === 35, 'numeric token coordinate mapping mismatch');

  expect(
    result.tokens.some((token) => token.text === '노트'),
    'general semantic/non-numeric OCR token must be preserved',
  );
  expect(
    result.tokens.some((token) => token.text === '17.5'),
    'non-overlapping numeric evidence must remain available to layout strategy',
  );

  const failingWorker = {
    async setParameters() {},
    async recognize() {
      throw new Error('fixture recognition failed');
    },
    async terminate() {
      terminated += 1;
    },
  };
  const failingExtractor = new module.TesseractScheduleImageTextExtractor(
    { async create() { return failingWorker; } },
    preprocessor,
  );

  let failurePropagated = false;
  const beforeFailureTerminate = terminated;
  try {
    await failingExtractor.extract({ name: 'broken.png', type: 'image/png' });
  } catch (error) {
    failurePropagated = error instanceof Error && error.message === 'fixture recognition failed';
  }
  expect(failurePropagated, 'OCR recognition failure must propagate instead of inventing evidence');
  expect(terminated === beforeFailureTerminate + 1, 'OCR worker must terminate after recognition failure');
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5W local-first OCR adapter verification passed');
