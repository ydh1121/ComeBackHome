import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const failures = [];
const nav = await read('../src/shared/layout/BottomNavigation.tsx');
const shell = await read('../src/shared/layout/AppShell.tsx');
const top = await read('../src/shared/layout/TopUtility.tsx');
const back = await read('../src/shared/components/BackButton.tsx');
const css = await read('../src/shared/layout/app-shell.css');

const expectedNav = [
  ["to: '/'", "label: '오늘'"],
  ["to: '/schedule'", "label: '일정'"],
  ["to: '/import'", "label: '가져오기'"],
  ["to: '/people'", "label: '사람'"],
];

let cursor = -1;
for (const [route, label] of expectedNav) {
  const routeIndex = nav.indexOf(route, cursor + 1);
  const labelIndex = nav.indexOf(label, routeIndex);
  if (routeIndex < 0 || labelIndex < routeIndex) failures.push(`missing or reordered bottom nav item: ${route} ${label}`);
  cursor = labelIndex;
}

if (!shell.includes("location.pathname === '/'")) failures.push('TopUtility must be Today-only');
if (!top.includes("navigate('/settings')")) failures.push('TopUtility settings action must navigate to /settings');
if (!back.includes('aria-label="뒤로 가기"')) failures.push('BackButton accessible label missing');
if (!css.includes('width: 44px;') || !css.includes('height: 44px;')) failures.push('44px touch target contract missing');
if (!css.includes('padding: 16px 18px 8px;')) failures.push('TopUtility 18px horizontal padding contract missing');
if (!css.includes('grid-template-columns: repeat(4, minmax(0, 1fr));')) failures.push('four-column bottom navigation contract missing');
if (!css.includes('env(safe-area-inset-bottom)')) failures.push('bottom safe-area contract missing');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 3 ui contract verification passed');
