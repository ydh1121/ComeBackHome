import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const failures = [];
const overview = await read('../src/pages/SchedulePage.tsx');
const bulk = await read('../src/pages/ScheduleBulkEditPage.tsx');
const day = await read('../src/pages/ScheduleDayEditPage.tsx');
const range = await read('../src/features/schedule/ScheduleRangePicker.tsx');
const css = await read('../src/pages/schedule-page.css');
const router = await read('../src/app/router.tsx');
const actions = await read('../src/application/services/ApplicationActions.ts');

for (const text of ['1일','1주','2주','1개월','일괄 입력','일정 편집']) {
  if (!overview.includes(text)) failures.push('overview missing ' + text);
}
for (const text of ['일정 일괄 입력','기간 내 적용 요일','출근','퇴근','적용']) {
  if (!bulk.includes(text)) failures.push('bulk missing ' + text);
}
for (const text of ['일정 수정','근무일','출근','퇴근','저장']) {
  if (!day.includes(text)) failures.push('day missing ' + text);
}
for (const text of ['스크롤로 선택','직접 입력','달력에서 선택']) {
  if (!range.includes(text)) failures.push('range missing ' + text);
}

if (!actions.includes('class ScheduleService')) failures.push('ScheduleService missing');
if (!actions.includes('saveDay(') || !actions.includes('applyBulk(')) failures.push('schedule mutations missing');
if (!router.includes("path === '/schedule'")) failures.push('schedule route missing');
if (!router.includes("path === '/schedule/edit'")) failures.push('bulk route missing');
if (!router.includes("path === '/schedule/:date/edit'")) failures.push('day route missing');
if (!css.includes('.schedule-page .segment')) failures.push('segment style missing');
if (!css.includes('.schedule-page .weekday-grid')) failures.push('weekday style missing');
if (!css.includes('.schedule-page .range-picker-v13')) failures.push('range style missing');

for (const [name, source] of [['overview', overview], ['bulk', bulk], ['day', day]]) {
  if (source.includes('/mocks/') || source.includes('/providers/')) failures.push(name + ' imports infrastructure');
  if (source.includes('contracts/repositories')) failures.push(name + ' imports repositories');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('phase 4B schedule workflow verification passed');
