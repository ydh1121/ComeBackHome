import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const failures = [];
const place = await read('../src/pages/PlaceEditPage.tsx');
const route = await read('../src/pages/CommuteRoutePage.tsx');
const manual = await read('../src/pages/CommuteManualPage.tsx');
const access = await read('../src/pages/TransitAccessPage.tsx');
const search = await read('../src/pages/TransitSearchPage.tsx');
const bus = await read('../src/pages/BusRoutePage.tsx');
const service = await read('../src/application/services/CommuteWorkflowService.ts');
const runtime = await read('../src/application/contracts/runtime.ts');
const repository = await read('../src/application/contracts/repositories.ts');
const router = await read('../src/app/router.tsx');
const manifest = await read('../src/application/route-manifest.ts');
const css = await read('../src/pages/commute-page.css');

for (const text of ['장소 이름','도로명·건물명 검색','상세주소','onCompositionStart','250','actions.places.save']) if (!place.includes(text)) failures.push('place missing ' + text);
for (const text of ['경로 설정','내 경로','자동 경로','actions.commute.selectRouteCandidate','다른 경로']) if (!route.includes(text)) failures.push('route missing ' + text);
for (const text of ['내 경로 편집','구간 추가','draggable','ArrowUp','ArrowDown','actions.commute.movePreferenceStep']) if (!manual.includes(text)) failures.push('manual missing ' + text);
for (const text of ['근처 교통','전체','지하철','버스','actions.transitAccess.toggleAccess','다른 교통 추가']) if (!access.includes(text)) failures.push('access missing ' + text);
for (const text of ['교통 추가','역·정류장명 검색','onCompositionStart','250','routeEdit','actions.transitSearch.addAccessPoint']) if (!search.includes(text)) failures.push('search missing ' + text);
for (const text of ['버스 선택','이름 수정','공식명','이 정류장을 지나는 버스','actions.busRoutes.setAlias','actions.busRoutes.selectRoute']) if (!bus.includes(text)) failures.push('bus missing ' + text);

for (const path of [
  '/people/:personId/place/origin',
  '/people/:personId/place/destination',
  '/people/:personId/commute',
  '/people/:personId/commute/manual',
  '/people/:personId/commute/:placeKind/access',
  '/people/:personId/commute/:placeKind/access/search',
  '/people/:personId/commute/:placeKind/access/:accessId/bus-routes',
]) {
  if (!manifest.includes("'" + path + "'")) failures.push('manifest missing ' + path);
  if (!router.includes("'" + path + "'")) failures.push('router missing ' + path);
}

for (const text of ['places: PlaceActions','commute: CommuteActions','transitSearch: TransitSearchActions','busRoutes: BusRouteActions']) if (!runtime.includes(text)) failures.push('runtime missing ' + text);
for (const text of ['upsertAccessPoint','setAccessPointAlias','setSelectedBusRoute','getPreferredRouteCandidateId','setPreferredRouteCandidateId']) if (!repository.includes(text)) failures.push('repository missing ' + text);
for (const text of ['class PlaceService','class CommuteService','class TransitSearchService','class BusRouteService']) if (!service.includes(text)) failures.push('service missing ' + text);
if (!manual.includes("aria-label="구간 순서 이동"")) failures.push('manual reorder aria label missing');
if (manifest.includes('/commute/edit') || manifest.includes('/access/bus')) failures.push('prototype route aliases leaked into canonical manifest');
if (!css.includes('.commute-page .route-candidate') || !css.includes('.commute-page .transit-row') || !css.includes('.commute-page .bus-route-option')) failures.push('commute styles missing');

for (const [name, source] of [['place', place], ['route', route], ['manual', manual], ['access', access], ['search', search], ['bus', bus]]) {
  if (source.includes('/mocks/') || source.includes('/providers/')) failures.push(name + ' imports infrastructure');
  if (source.includes('contracts/repositories')) failures.push(name + ' imports repositories');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 4E commute workflow verification passed');
