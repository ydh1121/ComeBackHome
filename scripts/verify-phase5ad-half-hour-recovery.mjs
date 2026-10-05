import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { buildPunctuationLostHalfHourScheduleLayoutFixture } from '../test/fixtures/import/sample-image-layout.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const module = await vite.ssrLoadModule('/src/providers/import/StructuredTableImageScheduleRecognizer.ts');

  const cases = [
    ['95', '09:30'],
    ['105', '10:30'],
    ['125', '12:30'],
    ['135', '13:30'],
    ['205', '20:30'],
    ['215', '21:30'],
    ['235', '23:30'],
  ];

  for (const [source, expected] of cases) {
    expect(
      module.parseScheduleHour(source) === expected,
      'compact half-hour recovery mismatch: ' + source,
    );
  }

  expect(
    module.parseScheduleHour('15') === '15:00',
    'valid integer 15 must not be reinterpreted as 1.5',
  );
  expect(
    module.parseScheduleHour('23') === '23:00',
    'valid integer 23 must remain an integer hour',
  );
  expect(
    module.parseScheduleHour('285') === null,
    'invalid compact half-hour 285 must remain rejected',
  );
  expect(
    module.parseScheduleHour('211') === null,
    'ambiguous numeric 211 must remain rejected',
  );
  expect(
    module.parseScheduleHour('2395') === null,
    'merged/ambiguous numeric 2395 must remain rejected',
  );

  const parsed = module.parseScheduleImageLayout(
    buildPunctuationLostHalfHourScheduleLayoutFixture({ targetRow: 3 }),
  );

  expect(
    parsed.structure.sheet.includes('calendar-strip'),
    'punctuation-lost fixture must retain calendar-strip reconstruction',
  );

  const target = parsed.scheduleCandidates
    .filter((item) => item.sourcePersonName === '테스트직원')
    .sort((a, b) => a.date.localeCompare(b.date));

  const expected = [
    ['2026-08-18', '12:00', '23:30'],
    ['2026-08-20', '12:00', '23:30'],
    ['2026-08-21', '11:00', '23:30'],
    ['2026-08-22', '10:30', '20:30'],
    ['2026-08-23', '10:30', '20:00'],
  ];

  expect(target.length === expected.length, 'punctuation-lost target candidate count mismatch');

  for (const [date, start, end] of expected) {
    const item = target.find((candidate) => candidate.date === date);
    expect(
      item?.start === start && item?.end === end,
      'punctuation-lost schedule mismatch for ' + date,
    );
  }

  expect(
    parsed.structure.needsReview === true,
    'half-hour recovery must remain review-only',
  );
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5AD safe compact half-hour recovery verification passed');
