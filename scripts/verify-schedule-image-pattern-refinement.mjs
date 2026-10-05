import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import {
  buildScheduleImageLayoutFixture,
  buildSparseCalendarDateScheduleLayoutFixture,
} from '../test/fixtures/import/sample-image-layout.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const word = (text, confidence, x0, y0, x1, y1) => ({
  text,
  confidence,
  bbox: { x0, y0, x1, y1 },
});
const page = (words) => ({
  blocks: words.length
    ? [{
        paragraphs: [{
          lines: [{ words }],
        }],
      }]
    : [],
});

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const imageModule = await vite.ssrLoadModule(
    '/src/providers/import/StructuredTableImageScheduleRecognizer.ts',
  );
  const ocrModule = await vite.ssrLoadModule(
    '/src/providers/import/TesseractScheduleImageTextExtractor.ts',
  );
  const batchModule = await vite.ssrLoadModule(
    '/src/providers/import/ScheduleBatchPatternSummary.ts',
  );

  const base = buildScheduleImageLayoutFixture({ targetRow: 3 });
  const WIDTH = base.width;
  const HEIGHT = base.height;
  const targetRowCenter = 121.5 + 3 * 27;
  const dayWidth = (WIDTH - 87) / 7;
  const targetStartX = 87 + dayWidth * 4 + dayWidth / 6;

  const generalWords = base.tokens
    .filter((item) => {
      const cy = item.y + item.height / 2;
      return !(item.text === '11' && Math.abs(cy - targetRowCenter) < 2);
    })
    .map((item) => {
      const cy = item.y + item.height / 2;
      const text =
        item.text === '직원A'
          ? 'wana'
          : item.text === '테스트직원' && Math.abs(cy - targetRowCenter) < 2
            ? '소소담'
            : item.text;
      const confidence = item.text === '직원A'
        ? 46
        : item.confidence * 100;
      return word(
        text,
        confidence,
        item.x,
        item.y,
        item.x + item.width,
        item.y + item.height,
      );
    });

  const numericWords = generalWords.filter((item) =>
    /^[0-9][0-9.,:/-]*$/.test(item.text)
  );

  const expectedNames = [
    '직원A',
    '직원B',
    '직원C',
    '신입가나다',
    '직원E',
    '직원F',
  ];

  let parameterMode = 'general';
  let personIndex = 0;
  const recognizeCalls = [];

  const worker = {
    async setParameters(params) {
      if (params.tessedit_char_whitelist === '') {
        parameterMode = 'person';
      } else if (params.tessedit_char_whitelist === '0123456789.,:/-') {
        parameterMode = 'numeric';
      } else {
        parameterMode = 'general';
      }
    },
    async recognize(_image, options = {}, _output) {
      recognizeCalls.push({ mode: parameterMode, options: structuredClone(options) });

      if (!options.rectangle) {
        if (recognizeCalls.length === 1) return { data: page(generalWords) };
        return { data: page(numericWords) };
      }

      if (parameterMode === 'person') {
        const label = expectedNames[personIndex++] ?? '';
        return label
          ? { data: page([word(label, 97, 1, 1, 80, 18)]) }
          : { data: page([]) };
      }

      if (parameterMode === 'numeric') {
        const rectangle = options.rectangle;
        const insideTarget =
          targetStartX >= rectangle.left &&
          targetStartX < rectangle.left + rectangle.width &&
          targetRowCenter >= rectangle.top &&
          targetRowCenter < rectangle.top + rectangle.height;
        return insideTarget
          ? { data: page([word('11', 95, 1, 1, 20, 18)]) }
          : { data: page([]) };
      }

      return { data: page([]) };
    },
    async terminate() {},
  };

  const preprocessor = {
    async prepare(file) {
      return {
        image: file,
        sourceWidth: WIDTH,
        sourceHeight: HEIGHT,
        rasterWidth: WIDTH,
        rasterHeight: HEIGHT,
      };
    },
  };

  const extractor = new ocrModule.TesseractScheduleImageTextExtractor(
    { async create() { return worker; } },
    preprocessor,
    { minimumConfidence: 0.18 },
  );

  const corruptedLayout = {
    ...base,
    tokens: base.tokens.map((item) =>
      item.text === '직원A'
        ? { ...item, text: 'wana', confidence: 0.46 }
        : item
    ),
  };
  const corruptedProbes =
    imageModule.inferSchedulePersonLabelProbeRegions(corruptedLayout);
  expect(
    corruptedProbes.length === 6,
    'normal-height structural row must still receive a focused name probe when its OCR label is unusable',
  );

  const unsafeAnchorLayout =
    buildSparseCalendarDateScheduleLayoutFixture({ targetRow: 3 });
  const unsafeAnchorProbes =
    imageModule.inferSchedulePersonLabelProbeRegions(unsafeAnchorLayout);
  expect(
    unsafeAnchorProbes.length === 5,
    'small auxiliary/unsafe first-row label must remain a structural boundary without becoming a person probe',
  );

  const refined = await extractor.extract({
    name: 'same-layout-family.png',
    type: 'image/png',
  });

  expect(
    imageModule.parseScheduleHour('25') === null,
    'ambiguous compact 25 must not be reinterpreted as 02:30',
  );
  expect(
    imageModule.parseScheduleImageClock('2') === null &&
      imageModule.parseScheduleImageClock('2.5') === null,
    'duration-shaped low values must not become schedule clock evidence',
  );
  expect(
    imageModule.parseScheduleImageClock('9') === '09:00' &&
      imageModule.parseScheduleImageClock('23.5') === '23:30',
    'normal schedule-family clock values must remain accepted',
  );

  const parsed = imageModule.parseScheduleImageLayout(refined);
  expect(
    parsed.detectedPeople.some((person) => person.sourceName === '직원a'),
    'focused OCR must recover a normal-height person row even when the preliminary label is unusable',
  );
  expect(
    parsed.detectedPeople.some((person) => person.sourceName === '신입가나다'),
    'row-focused OCR must replace the preliminary misread label with a source label candidate',
  );
  expect(
    !parsed.detectedPeople.some((person) => person.sourceName === '소소담'),
    'preliminary person-label misread must not survive a stronger row-focused pass',
  );

  const recovered = parsed.scheduleCandidates.find(
    (item) =>
      item.sourcePersonName === '신입가나다' &&
      item.date === '2026-08-21',
  );
  expect(
    recovered?.start === '11:00' && recovered?.end === '23:30',
    'systematic unresolved-cell probe must recover the missing start time',
  );

  const pattern = imageModule.analyzeScheduleImagePattern(refined);
  expect(pattern != null, 'refined date-block image must expose a pattern analysis');
  const targetCells = pattern?.cells.filter(
    (cell) => cell.sourcePersonName === '신입가나다',
  ) ?? [];
  expect(
    targetCells.filter((cell) => cell.state === 'WORK').length === 5,
    'target row must expose five work cells',
  );
  expect(
    targetCells.filter((cell) => cell.state === 'OFF_OR_BLANK').length === 2,
    'target row must preserve two off/blank cells',
  );
  expect(
    targetCells.filter((cell) => cell.state === 'INCOMPLETE').length === 0,
    'systematic probe must leave no incomplete target cell in the fixture',
  );

  const personRegionCalls = recognizeCalls.filter(
    (call) => call.mode === 'person' && call.options.rectangle,
  );
  expect(
    personRegionCalls.every((call) =>
      call.options.rectangle.left === 0 &&
      call.options.rectangle.width > 20
    ),
    'left-side person labels must receive a real left-column ROI, not a 1px right-edge probe',
  );
  const targetedNumericCalls = recognizeCalls.filter(
    (call) => call.mode === 'numeric' && call.options.rectangle,
  );
  expect(
    personRegionCalls.length === 6,
    'every detected person row must receive exactly one focused name read',
  );
  expect(
    targetedNumericCalls.length > 0,
    'unresolved work/off cells must receive structured start/end reads',
  );

  const strongestFixture = buildScheduleImageLayoutFixture({ targetRow: 3 });
  strongestFixture.tokens.push({
    text: '2',
    x: 421,
    y: 194,
    width: 18,
    height: 14,
    confidence: 0.55,
  });
  strongestFixture.tokens.push({
    text: '22',
    x: 421,
    y: 194,
    width: 18,
    height: 14,
    confidence: 0.96,
  });
  const strongestPattern = imageModule.analyzeScheduleImagePattern(strongestFixture);
  const strongestCell = strongestPattern?.cells.find(
    (cell) => cell.sourcePersonName === '테스트직원',
  );
  expect(
    strongestCell == null || strongestCell.end !== '02:00',
    'pattern analysis must not let an earlier weaker OCR token override stronger clock evidence',
  );

  const makePattern = (sourceName, cells) => ({
    strategy: 'date-block-matrix',
    people: [{ sourceRow: 1, sourceName, confidence: 0.9 }],
    dates: cells.map((cell) => cell.date),
    probeRegions: [],
    cells: cells.map((cell) => ({
      sourceRow: 1,
      sourcePersonName: sourceName,
      numericEvidenceCount: cell.state === 'OFF_OR_BLANK' ? 0 : 2,
      start: cell.start ?? null,
      end: cell.end ?? null,
      ...cell,
    })),
  });

  const batchSummary = batchModule.buildScheduleBatchPatternSummary([
    {
      sourceName: 'week-a.png',
      pattern: makePattern('강성배', [
        { date: '2026-07-20', state: 'WORK', start: '09:00', end: '21:00' },
      ]),
    },
    {
      sourceName: 'week-b.png',
      pattern: makePattern('강성배', [
        { date: '2026-07-27', state: 'WORK', start: '09:00', end: '21:00' },
      ]),
    },
    {
      sourceName: 'week-c.png',
      pattern: makePattern('성배', [
        { date: '2026-08-03', state: 'WORK', start: '09:00', end: '21:00' },
      ]),
    },
    {
      sourceName: 'week-d.png',
      pattern: makePattern('소소담', [
        { date: '2026-08-17', state: 'WORK', start: '14:00', end: '23:30' },
      ]),
    },
    {
      sourceName: 'week-e.png',
      pattern: makePattern('강성배', [
        { date: '2026-08-24', state: 'INCOMPLETE', start: '09:00', end: null },
      ]),
    },
  ]);

  expect(
    batchSummary.labelVariantSuggestions.some(
      (item) =>
        item.sourceName === '성배' &&
        item.suggestedCanonical === '강성배' &&
        item.reviewOnly === true,
    ),
    'one-character OCR label loss should be surfaced as a review-only variant suggestion',
  );
  expect(
    !batchSummary.labelVariantSuggestions.some(
      (item) => item.sourceName === '소소담',
    ),
    'a structurally valid unseen label must not be guessed into an existing person',
  );
  expect(
    batchSummary.people.find((item) => item.sourceName === '소소담')
      ?.classification === 'SINGLE_OR_UNSEEN_LABEL',
    'single unseen labels must remain preserved as possible new employees',
  );
  expect(
    batchSummary.incompleteTimeSuggestions.some(
      (item) =>
        item.sourcePersonName === '강성배' &&
        item.date === '2026-08-24' &&
        item.knownField === 'start' &&
        item.knownTime === '09:00' &&
        item.suggestedField === 'end' &&
        item.suggestedTime === '21:00' &&
        item.supportFileCount === 2 &&
        item.reviewOnly === true,
    ),
    'repeated same-person time-pair evidence must produce a review-only incomplete-time suggestion',
  );
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('schedule image pattern refinement verification passed');
