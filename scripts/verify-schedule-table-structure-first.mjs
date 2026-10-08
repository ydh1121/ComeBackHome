import { createServer as createViteServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

function makeRaster({
  width = 1120,
  height = 430,
  left = 90,
  top = 55,
  rows = 5,
  cols = 8,
  line = 2,
  background = 246,
  grid = 78,
  text = 42,
  contentCells = [],
} = {}) {
  const luminance = new Uint8Array(width * height);
  luminance.fill(background);

  const right = width - 28;
  const bottom = height - 24;
  const rowHeight = (bottom - top) / rows;
  const colWidth = (right - left) / cols;

  const fillRect = (x, y, w, h, value) => {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(width, Math.ceil(x + w));
    const y1 = Math.min(height, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy += 1) {
      for (let xx = x0; xx < x1; xx += 1) luminance[yy * width + xx] = value;
    }
  };

  for (let r = 0; r <= rows; r += 1) {
    fillRect(left, top + r * rowHeight - line / 2, right - left, line, grid);
  }
  for (let c = 0; c <= cols; c += 1) {
    fillRect(left + c * colWidth - line / 2, top, line, bottom - top, grid);
  }

  // person labels in first column
  for (let r = 1; r < rows; r += 1) {
    fillRect(left + 10, top + r * rowHeight + rowHeight * 0.37, colWidth * 0.46, Math.max(3, rowHeight * 0.12), text);
  }

  // date/header text in header row
  for (let c = 1; c < cols; c += 1) {
    fillRect(left + c * colWidth + colWidth * 0.26, top + rowHeight * 0.24, colWidth * 0.45, Math.max(3, rowHeight * 0.1), text);
  }

  for (const [r, c] of contentCells) {
    fillRect(
      left + c * colWidth + colWidth * 0.22,
      top + r * rowHeight + rowHeight * 0.34,
      colWidth * 0.52,
      Math.max(4, rowHeight * 0.16),
      text,
    );
  }

  return {
    raster: { width, height, luminance },
    geometry: { left, top, right, bottom, rowHeight, colWidth, rows, cols },
  };
}

function token(text, cx, cy, width = 54, height = 18, confidence = 0.96) {
  return { text, x: cx - width / 2, y: cy - height / 2, width, height, confidence };
}

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const detector = await vite.ssrLoadModule('/src/providers/import/ScheduleTableStructureDetector.ts');
  const matrixModule = await vite.ssrLoadModule('/src/providers/import/ScheduleCellMatrix.ts');

  let structurePass = 0;
  const variants = [];
  for (const line of [1, 2, 3]) {
    for (const width of [960, 1120, 1380]) {
      for (const top of [38, 55]) {
        variants.push({ line, width, top });
      }
    }
  }

  for (const variant of variants) {
    const { raster, geometry } = makeRaster({
      ...variant,
      contentCells: [[1, 1], [1, 2], [2, 3], [3, 5], [4, 6]],
    });
    const structure = detector.detectScheduleTableStructureFromRaster(raster);
    expect(
      structure.rowBands.length >= geometry.rows - 1,
      'pixel grid row detection failed for ' + JSON.stringify(variant),
    );
    expect(
      structure.columnBands.length >= geometry.cols - 1,
      'pixel grid column detection failed for ' + JSON.stringify(variant),
    );
    expect(
      structure.evidence.source === 'PIXEL_GRID',
      'strong raster grid must be PIXEL_GRID for ' + JSON.stringify(variant),
    );
    structurePass += 1;
  }

  const { raster, geometry } = makeRaster({
    width: 1180,
    height: 450,
    line: 2,
    contentCells: [[1, 1], [1, 2], [2, 3], [3, 4]],
  });
  const structure = detector.detectScheduleTableStructureFromRaster(raster);
  const dates = Array.from({ length: 7 }, (_, index) => {
    const col = index + 1;
    return token(
      '2026-10-' + String(20 + index).padStart(2, '0'),
      geometry.left + (col + 0.5) * geometry.colWidth,
      geometry.top + geometry.rowHeight * 0.28,
      90,
      16,
    );
  });
  const names = ['가나다', '라마바', '사아자', '차카타'].map((name, index) =>
    token(
      name,
      geometry.left + geometry.colWidth * 0.45,
      geometry.top + (index + 1.5) * geometry.rowHeight,
      58,
      18,
    )
  );
  const layout = {
    width: raster.width,
    height: raster.height,
    tokens: [...dates, ...names],
  };
  const detection = {
    structure,
    raster,
    preprocessingMs: 3,
    structureDetectionMs: 4,
  };
  const matrix = matrixModule.buildScheduleCellMatrix(detection, layout);
  expect(matrix != null, 'person-date matrix was not constructed from raster geometry');
  expect(matrix?.rows.length === 4, 'matrix person row count mismatch');
  expect(matrix?.dates.length === 7, 'matrix date column count mismatch');
  expect(matrix?.cells.length === 28, 'matrix cell count mismatch');

  if (matrix) {
    const emptyCell = matrix.cells.find((cell) => cell.sourceRow === 4 && cell.date === '2026-10-20');
    const contentCell = matrix.cells.find((cell) => cell.sourceRow === 1 && cell.date === '2026-10-20');
    expect(emptyCell?.visual.occupancy === 'EMPTY', 'visual blank cell must classify EMPTY');
    expect(contentCell?.visual.occupancy !== 'EMPTY', 'visual content cell must not classify EMPTY');
  }

  const bareDays = dates.map((date, index) => ({
    ...date,
    text: String(20 + index),
  }));
  const bareDayMatrix = matrixModule.buildScheduleCellMatrix(detection, {
    ...layout,
    tokens: [
      token('2026년', 24, 18, 55),
      token('10월', 93, 18, 42),
      ...bareDays,
      ...names,
    ],
  });
  expect(bareDayMatrix?.dates.length === 7,
    'numeric-only day headers must resolve against the visible year/month context');
  expect(bareDayMatrix?.rows.length === 4,
    'calendar-only header must not be promoted into a person row');

  const interpreter = await vite.ssrLoadModule('/src/providers/import/StructureFirstScheduleImageRecognizer.ts');
  if (matrix) {
    const mislabeledMatrix = {
      ...matrix,
      rows: matrix.rows.map((row, index) => index === 0
        ? { ...row, preliminaryName: '쉬는시간', preliminaryConfidence: 0.99 }
        : index === 1
          ? { ...row, preliminaryName: 'za', preliminaryConfidence: 0.99 }
          : index === 2
            ? { ...row, preliminaryName: '사아자', preliminaryConfidence: 0.2 }
            : row),
    };
    const personRegions = [
      { id: 'person::1', purpose: 'person', text: '쉬는시간', tokens: [], confidence: 0.99 },
      { id: 'person::2', purpose: 'person', text: 'sole', tokens: [], confidence: 0.99 },
      { id: 'person::3', purpose: 'person', text: '사아자', tokens: [], confidence: 0.2 },
    ];
    const interpreted = interpreter.interpretStructureFirstSchedule(
      mislabeledMatrix, personRegions, ['사아자'],
    );
    const personNames = interpreted.detectedPeople.map((person) => person.sourceName);
    expect(!personNames.includes('쉬는시간') && !personNames.includes('za') && !personNames.includes('sole'),
      'header and Latin OCR noise must never be detected as people');
    expect(personNames.includes('사아자'),
      'registered person name must be accepted as a strong OCR prior');
    expect(interpreted.scheduleCandidates.concat(interpreted.reviewCandidates ?? [])
      .every((candidate) => personNames.includes(candidate.sourcePersonName)),
      'unrecognized person rows must not produce import candidates');
  }

  // Recognizer's known-person prior is read at EACH import. A person
  // registered after app bootstrap must be recognized on the next image,
  // without promoting OCR garbage or creating a DB person automatically.
  const currentRoster = [];
  const weakLayout = {
    ...layout,
    tokens: layout.tokens.map((item) =>
      item.text === '사아자' ? { ...item, confidence: 0.2 } : item),
  };
  const mockExtractor = {
    async extract() { return weakLayout; },
    async extractRegions(_image, regions) {
      return regions.map((region) => ({
        id: region.id,
        purpose: region.purpose,
        text: region.id === 'person::3' ? '사아자' : '',
        confidence: region.id === 'person::3' ? 0.2 : 0,
        tokens: [],
      }));
    },
  };
  const dynamicRecognizer = new interpreter.StructureFirstScheduleImageRecognizer(
    { async detect() { return detection; } },
    mockExtractor,
    async () => [...currentRoster],
  );
  const sampleImage = new File([new Uint8Array([1])], 'local-private-fixture.png', { type: 'image/png' });
  const priorBefore = await dynamicRecognizer.parse(sampleImage);
  currentRoster.push('사아자');
  const priorAfter = await dynamicRecognizer.parse(sampleImage);
  expect(!priorBefore.detectedPeople.some((person) => person.sourceName === '사아자'),
    'low-confidence novel row must not be promoted to registered person');
  expect(priorAfter.detectedPeople.some((person) => person.sourceName === '사아자'),
    'newly registered person must be recognized from current prior on next import');

  // Color/fill alone must not imply work or off. A flat darker background with
  // no text remains EMPTY because occupancy is measured relative to local background.
  const colored = makeRaster({
    width: 1080,
    height: 420,
    line: 2,
    background: 218,
    contentCells: [],
  });
  const coloredBounds = {
    x: colored.geometry.left + colored.geometry.colWidth,
    y: colored.geometry.top + colored.geometry.rowHeight,
    width: colored.geometry.colWidth,
    height: colored.geometry.rowHeight,
  };
  const coloredEvidence = detector.analyzeScheduleCellVisualEvidence(colored.raster, coloredBounds);
  expect(coloredEvidence.occupancy === 'EMPTY', 'flat colored blank cell must remain EMPTY');

  // Content without OCR tokens is the UNREADABLE precursor, never OFF.
  const unreadable = makeRaster({
    width: 1080,
    height: 420,
    line: 2,
    contentCells: [[2, 2]],
  });
  const unreadableBounds = {
    x: unreadable.geometry.left + unreadable.geometry.colWidth * 2,
    y: unreadable.geometry.top + unreadable.geometry.rowHeight * 2,
    width: unreadable.geometry.colWidth,
    height: unreadable.geometry.rowHeight,
  };
  const unreadableEvidence = detector.analyzeScheduleCellVisualEvidence(unreadable.raster, unreadableBounds);
  expect(unreadableEvidence.occupancy === 'CONTENT', 'foreground without OCR must remain CONTENT/UNREADABLE precursor');

  console.log(JSON.stringify({
    result: failures.length ? 'FAIL' : 'PASS',
    rasterVariants: variants.length,
    structurePass,
    matrixCells: matrix?.cells.length ?? 0,
    offVsUnreadableSeparated: coloredEvidence.occupancy === 'EMPTY' && unreadableEvidence.occupancy === 'CONTENT',
  }, null, 2));
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
