import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const failures = [];
const page = await read('../src/pages/TodayPage.tsx');
const css = await read('../src/pages/today-page.css');
const router = await read('../src/app/router.tsx');
const query = await read('../src/application/queries/ComeBackHomeQueries.ts');

const requiredPageFragments = [
  'data-page="TodayPage"',
  'WORKING ARRIVAL_ESTIMATED NEXT_SHIFT_KNOWN',
  '사람 선택',
  '집 도착 예정',
  '퇴근',
  '다음 출근',
  '일정',
  '이동 경로',
  "navigate('/schedule')",
  "navigate('/people')",
  "step.type !== 'WALKING'",
  'services.actions.personSelection.select',
  'aria-label="사람 선택 닫기"',
];

for (const fragment of requiredPageFragments) {
  if (!page.includes(fragment)) failures.push(`TodayPage contract missing: ${fragment}`);
}

if (!router.includes("path === '/' ? TodayPage")) failures.push('root route is not wired to TodayPage');
if (!query.includes('getTodayOverview(referenceDate: ISODate)')) failures.push('Today overview query missing');
if (!query.includes('this.repositories.today.get(selectedId)')) failures.push('TodayPage data must cross TodayRepository boundary');
if (!css.includes('padding: 0 18px 28px;')) failures.push('Today page 18px horizontal padding missing');
if (!css.includes('background: #f3f7ff;')) failures.push('Today hero surface mismatch');
if (!css.includes('font-size: 46px;')) failures.push('Today big-time size mismatch');
if (!css.includes('grid-template-columns: 1fr 1fr;')) failures.push('Today two-column metadata contract missing');
if (!css.includes('min-height: 60px;')) failures.push('Today action touch/height contract missing');
if (!css.includes('env(safe-area-inset-bottom)')) failures.push('Person picker bottom safe-area contract missing');
if (/from ['\"].*(mocks|providers)//.test(page)) failures.push('TodayPage imports infrastructure directly');
if (page.includes('contracts/repositories')) failures.push('TodayPage imports repository contracts directly');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 4A TodayPage contract verification passed');
