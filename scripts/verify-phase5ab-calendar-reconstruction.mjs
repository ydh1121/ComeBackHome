import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { buildSparseCalendarDateScheduleLayoutFixture } from '../test/fixtures/import/sample-image-layout.mjs';

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

  expect(
    module.parseScheduleDate('20260815') === '2026-08-15',
    'compact YYYYMMDD schedule date must normalize',
  );
  expect(
    module.parseScheduleDate('2026-08-15') === '2026-08-15',
    'dashed schedule date must remain supported',
  );
  expect(
    module.parseScheduleDate('20260230') === null,
    'invalid compact schedule date must fail closed',
  );

  const layout = buildSparseCalendarDateScheduleLayoutFixture({ targetRow: 3 });
  const parsed = module.parseScheduleImageLayout(layout);

  expect(
    parsed.structure.sheet.includes('calendar-strip'),
    'sparse calendar fixture must use weekday calendar reconstruction',
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

  expect(target.length === expected.length, 'reconstructed target schedule count mismatch');
  for (const [date, start, end] of expected) {
    const item = target.find((candidate) => candidate.date === date);
    expect(
      item?.start === start && item?.end === end,
      'reconstructed schedule mismatch for ' + date,
    );
  }

  expect(
    !parsed.detectedPeople.some((person) => /^a?ach$/i.test(person.sourceName)),
    'weak Latin row fragment must not become a detected person',
  );
  expect(
    !parsed.scheduleCandidates.some((item) => /^a?ach$/i.test(item.sourcePersonName)),
    'weak Latin row fragment must not emit schedule candidates',
  );

  expect(
    parsed.scheduleCandidates.every((item) => item.confidence <= 1 && item.confidence >= 0),
    'reconstructed candidate confidence must remain normalized',
  );
  expect(
    parsed.structure.needsReview === true,
    'calendar reconstruction must remain review-only',
  );
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5AB calendar strip reconstruction verification passed');

// Phase 5AB dependency-backed verification trigger.
