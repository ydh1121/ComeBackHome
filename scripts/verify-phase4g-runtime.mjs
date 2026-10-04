import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const failures = [];
const router = await read('../src/app/router.tsx');
const manifest = await read('../src/application/route-manifest.ts');
const stateMatrix = await read('../src/pages/QaStateMatrixPage.tsx');
const flow = await read('../src/pages/QaFlowMapPage.tsx');
const desktopDrop = await read('../src/pages/QaDesktopDropPage.tsx');
const qaCss = await read('../src/pages/qa-page.css');
const onlineHook = await read('../src/shared/runtime/useOnlineStatus.ts');
const formHook = await read('../src/shared/runtime/useFormRuntimeState.ts');

for (const path of ['/__qa/states','/__qa/flow','/__qa/desktop-drop']) {
  if (!manifest.includes("'" + path + "'")) failures.push('qa manifest missing ' + path);
  if (!router.includes("'" + path + "'")) failures.push('qa router missing ' + path);
}
if (!router.includes('import.meta.env.DEV ? qaRoutes')) failures.push('QA routes are not DEV gated');
if (!router.includes('qaComponentFor')) failures.push('QA route component mapping missing');

for (const text of ['상태 점검','오늘 · 도착 시간 상태','일정 · 보기 상태','근처 교통 · 필터 상태','Application boundary']) {
  if (!stateMatrix.includes(text)) failures.push('state matrix missing ' + text);
}
for (const text of ['화면 흐름','일정 → 일괄 입력','가져오기 → 사람 연결 → 구조 확인 → 검토','사람 → 추가/수정/상세','설정 → 알림 권한/규칙/테스트']) {
  if (!flow.includes(text)) failures.push('flow map missing ' + text);
}
for (const text of ['여기에 놓기','엑셀 · 이미지 · 여러 파일','desktop-drop-active','ImportPage']) {
  if (!desktopDrop.includes(text)) failures.push('desktop drop missing ' + text);
}
if (!qaCss.includes('.qa-desktop-drop .drag-overlay') || !qaCss.includes('.qa-page .matrix')) failures.push('QA styles missing');

if (!onlineHook.includes("window.addEventListener('online'") || !onlineHook.includes("window.addEventListener('offline'")) failures.push('online runtime hook incomplete');
for (const text of ["'CLEAN'","'DIRTY'","'SAVING'","'SAVED'","'ERROR'"]) {
  if (!formHook.includes(text)) failures.push('form runtime state missing ' + text);
}

const files = {};
for (const path of [
  '../src/pages/TodayPage.tsx',
  '../src/pages/SchedulePage.tsx',
  '../src/pages/ScheduleBulkEditPage.tsx',
  '../src/pages/ScheduleDayEditPage.tsx',
  '../src/pages/ImportPage.tsx',
  '../src/pages/ImportReviewPage.tsx',
  '../src/pages/PeoplePage.tsx',
  '../src/pages/PersonCreatePage.tsx',
  '../src/pages/PersonEditPage.tsx',
  '../src/pages/PlaceEditPage.tsx',
  '../src/pages/CommuteRoutePage.tsx',
  '../src/pages/TransitAccessPage.tsx',
  '../src/pages/TransitSearchPage.tsx',
  '../src/pages/BusRoutePage.tsx',
  '../src/pages/NotificationPage.tsx',
]) files[path] = await read(path);

for (const path of ['../src/pages/TodayPage.tsx','../src/pages/PlaceEditPage.tsx','../src/pages/TransitSearchPage.tsx']) {
  if (!files[path].includes('OFFLINE')) failures.push('offline state missing ' + path);
}
for (const path of ['../src/pages/ScheduleBulkEditPage.tsx','../src/pages/ScheduleDayEditPage.tsx','../src/pages/PersonCreatePage.tsx','../src/pages/PersonEditPage.tsx','../src/pages/PlaceEditPage.tsx']) {
  if (!files[path].includes('useFormRuntimeState')) failures.push('form runtime hook missing ' + path);
}
for (const path of ['../src/pages/SchedulePage.tsx','../src/pages/CommuteRoutePage.tsx','../src/pages/TransitAccessPage.tsx','../src/pages/TransitSearchPage.tsx','../src/pages/BusRoutePage.tsx','../src/pages/PeoplePage.tsx','../src/pages/ImportReviewPage.tsx']) {
  const source = files[path];
  if (!(source.includes('NO_RESULT') || source.includes('EMPTY') || source.includes('검색 결과가 없습니다') || source.includes('없습니다.') || source.includes('대기 중'))) {
    failures.push('no-result/empty state missing ' + path);
  }
}
for (const path of ['../src/pages/TodayPage.tsx','../src/pages/SchedulePage.tsx','../src/pages/PeoplePage.tsx','../src/pages/PersonEditPage.tsx','../src/pages/PlaceEditPage.tsx','../src/pages/CommuteRoutePage.tsx','../src/pages/TransitAccessPage.tsx','../src/pages/BusRoutePage.tsx','../src/pages/NotificationPage.tsx']) {
  const source = files[path];
  if (!source.includes('loading') && !source.includes('LOADING')) failures.push('loading state missing ' + path);
  if (!source.includes('error') && !source.includes('ERROR')) failures.push('error state missing ' + path);
}
for (const text of ['PERMISSION_DEFAULT','PERMISSION_DENIED','PERMISSION_GRANTED','SUBSCRIBED','PERMISSION_ERROR']) {
  if (!files['../src/pages/NotificationPage.tsx'].includes(text)) failures.push('permission state missing ' + text);
}

for (const [path, source] of Object.entries(files)) {
  if (source.includes('/mocks/') || source.includes('/providers/') || source.includes('contracts/repositories')) failures.push('page infrastructure leak ' + path);
}
for (const source of [stateMatrix, flow, desktopDrop]) {
  if (source.includes('/mocks/') || source.includes('/providers/') || source.includes('contracts/repositories')) failures.push('QA page infrastructure leak');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('phase 4G QA and runtime-state verification passed');
