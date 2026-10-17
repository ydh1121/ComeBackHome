import { readFile } from 'node:fs/promises';
import { createServer as createViteServer } from 'vite';
import { fileURLToPath } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };
const overview = await read('../src/pages/SchedulePage.tsx');
const bulk = await read('../src/pages/ScheduleBulkEditPage.tsx');
const day = await read('../src/pages/ScheduleDayEditPage.tsx');
const range = await read('../src/features/schedule/ScheduleRangePicker.tsx');
const timeWheel = await read('../src/shared/components/TimeRangeWheelPicker.tsx');
const css = await read('../src/pages/schedule-page.css');
const router = await read('../src/app/router.tsx');
const actions = await read('../src/application/services/ApplicationActions.ts');

for (const text of ['1일','1주','2주','1개월','일괄 입력','일정 편집','1일 일정 추가']) {
  if (!overview.includes(text)) failures.push('overview missing ' + text);
}
for (const text of ['일정 일괄 입력','기간 내 적용 요일','출근','퇴근','적용']) {
  if (!bulk.includes(text)) failures.push('bulk missing ' + text);
}
for (const text of ['일정 수정','1일 일정 추가','근무일','출근','퇴근','저장','type="date"']) {
  if (!day.includes(text)) failures.push('day missing ' + text);
}
for (const text of ['스크롤로 선택','직접 입력','달력에서 선택']) {
  if (!range.includes(text)) failures.push('range missing ' + text);
}

if (!actions.includes('class ScheduleService')) failures.push('ScheduleService missing');
if (!actions.includes('saveDay(') || !actions.includes('applyBulk(')) failures.push('schedule mutations missing');
if (!actions.includes('enumerateScheduleDates')) failures.push('bulk schedule date materialization missing');
if (!bulk.includes('currentLocalIsoDate')) failures.push('empty schedule date fallback missing');
if (!bulk.includes('!canApply')) failures.push('bulk empty-input apply guard missing');
if (!range.includes("useState<Mode>('wheel')") || !range.includes('buildWheelDates')) failures.push('schedule range wheel must work without existing schedules');
if (!router.includes("path === '/schedule'")) failures.push('schedule route missing');
if (!router.includes("path === '/schedule/edit'")) failures.push('bulk route missing');
if (!router.includes("path === '/schedule/new'")) failures.push('single-day creation route missing');
if (!router.includes("path === '/schedule/:date/edit'")) failures.push('day route missing');
if (!css.includes('.schedule-page .segment')) failures.push('segment style missing');
if (!css.includes('.schedule-page .weekday-grid')) failures.push('weekday style missing');
if (!css.includes('.schedule-page .range-picker-v13')) failures.push('range style missing');
if (!bulk.includes('TimeRangeWheelPicker') || !day.includes('TimeRangeWheelPicker')) failures.push('schedule start/end must use shared wheel picker');
if (bulk.includes('type="time"') || day.includes('type="time"')) failures.push('native schedule time inputs must be removed for iPhone parity');
for (const text of ['time-wheel-scroll','useLayoutEffect','scrollTop','minuteStep']) if (!timeWheel.includes(text)) failures.push('shared time wheel missing deterministic local centering: ' + text);

for (const [name, source] of [['overview', overview], ['bulk', bulk], ['day', day]]) {
  if (source.includes('/mocks/') || source.includes('/providers/')) failures.push(name + ' imports infrastructure');
  if (source.includes('contracts/repositories')) failures.push(name + ' imports repositories');
}

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const { ScheduleService } = await vite.ssrLoadModule('/src/application/services/ApplicationActions.ts');

  let emptyBatch = [];
  const emptyRepository = {
    async list() { return []; },
    async getByDate() { return null; },
    async upsert() {},
    async upsertMany(entries) { emptyBatch = structuredClone(entries); },
  };
  const selection = { getSelectedPersonId() { return 'person-1'; }, select() {} };
  const emptyService = new ScheduleService(emptyRepository, selection);
  await emptyService.applyBulk({
    from: '2026-10-07',
    to: '2026-10-10',
    weekdays: [3, 5],
    start: '09:00',
    end: '18:00',
  });

  expect(emptyBatch.length === 2, 'empty schedule bulk input must create selected dates');
  expect(emptyBatch.map((entry) => entry.date).join(',') === '2026-10-07,2026-10-09', 'bulk weekday materialization mismatch');
  expect(emptyBatch.every((entry) => entry.personId === 'person-1' && entry.enabled === true), 'bulk-created schedule identity/state mismatch');
  expect(emptyBatch.every((entry) => entry.start === '09:00' && entry.end === '18:00'), 'bulk-created schedule time mismatch');

  let allDaysBatch = [];
  const allDaysRepository = {
    async list() { return []; },
    async getByDate() { return null; },
    async upsert() {},
    async upsertMany(entries) { allDaysBatch = structuredClone(entries); },
  };
  const allDaysService = new ScheduleService(allDaysRepository, selection);
  await allDaysService.applyBulk({
    from: '2026-10-07',
    to: '2026-10-10',
    weekdays: [],
    start: '09:00',
    end: '18:00',
  });
  expect(allDaysBatch.length === 4, 'empty weekday filter must apply to every date in the range');

  const existingEntry = {
    id: 'existing-1',
    personId: 'person-1',
    date: '2026-10-08',
    enabled: false,
    start: '08:00',
    end: '17:00',
  };
  let mixedBatch = [];
  const mixedRepository = {
    async list() { return [structuredClone(existingEntry)]; },
    async getByDate() { return null; },
    async upsert() {},
    async upsertMany(entries) { mixedBatch = structuredClone(entries); },
  };
  const mixedService = new ScheduleService(mixedRepository, selection);
  await mixedService.applyBulk({
    from: '2026-10-07',
    to: '2026-10-08',
    weekdays: [3, 4],
    start: '10:00',
    end: '19:00',
  });

  expect(mixedBatch.length === 2, 'mixed bulk input must include new and existing dates');
  expect(mixedBatch.find((entry) => entry.date === '2026-10-08')?.id === 'existing-1', 'existing schedule id must be preserved');
  expect(mixedBatch.every((entry) => entry.start === '10:00' && entry.end === '19:00'), 'mixed bulk time update mismatch');
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('phase 4B schedule workflow verification passed');
