import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const failures = [];
const place = await read('../src/pages/PlaceEditPage.tsx');
const route = await read('../src/pages/CommuteRoutePage.tsx');
const manual = await read('../src/pages/CommuteManualPage.tsx');
const access = await read('../src/pages/TransitAccessPage.tsx');
const search = await read('../src/pages/TransitSearchPage.tsx');
const bus = await read('../src/pages/BusRoutePage.tsx');
const map = await read('../src/features/commute/KakaoTransitMap.tsx');
const service = await read('../src/application/services/CommuteWorkflowService.ts');
const runtime = await read('../src/application/contracts/runtime.ts');
const repository = await read('../src/application/contracts/repositories.ts');
const router = await read('../src/app/router.tsx');
const manifest = await read('../src/application/route-manifest.ts');
const css = await read('../src/pages/commute-page.css');
const providerRuntime = await read('../src/providers/runtime/ProviderRuntimeRepositories.ts');
const selectors = await read('../src/application/selectors/index.ts');

for (const text of ['장소 이름','도로명·건물명 검색','상세주소','onCompositionStart','250','actions.places.save']) if (!place.includes(text)) failures.push('place missing ' + text);
for (const text of ['경로 설정','경로 추가','savedRoutes','createSavedRoute','selectSavedRoute','자동 경로']) if (!route.includes(text)) failures.push('route missing ' + text);
for (const text of ['출발 교통수단 추가','경유 교통수단 추가','도착 교통수단 추가','routeRole=destination','draggable','ArrowUp','ArrowDown','moveRouteVia','removeRouteVia']) if (!manual.includes(text)) failures.push('manual missing ' + text);
for (const text of ['KakaoTransitMap','근처 교통','actions.transitSearch.nearby','actions.transitSearch.search','정류장명·번호 또는 역 이름 검색','addRouteOriginAccess','addRouteDestinationAccess','여러 곳을 선택할 수 있습니다']) if (!access.includes(text)) failures.push('access missing ' + text);
if (access.includes("navigate(base + '/search")) failures.push('access must not navigate to a separate direct-search page');
for (const text of ['버스 선택','이름 수정','listRoutes','이 정류장에서 이용 가능한 버스','actions.busRoutes.selectRoute','선택 완료']) if (!bus.includes(text)) failures.push('bus missing ' + text);
for (const text of ['dapi.kakao.com/v2/maps/sdk.js','/api/client-config','onSelect','kakao-map-error','다시 시도']) if (!map.includes(text)) failures.push('map missing ' + text);
if (map.includes('/api/providers/static-map')) failures.push('transit map must not silently fall back to a static image');

for (const path of [
  '/people/:personId/place/origin',
  '/people/:personId/place/destination',
  '/people/:personId/commute',
  '/people/:personId/commute/manual',
  '/people/:personId/commute/routes/:routeId',
  '/people/:personId/commute/:placeKind/access',
  '/people/:personId/commute/:placeKind/access/:accessId/bus-routes',
]) {
  if (!manifest.includes("'" + path + "'")) failures.push('manifest missing ' + path);
  if (!router.includes("'" + path + "'")) failures.push('router missing ' + path);
}

for (const text of ['places: PlaceActions','commute: CommuteActions','transitSearch: TransitSearchActions','busRoutes: BusRouteActions']) if (!runtime.includes(text)) failures.push('runtime missing ' + text);
for (const text of ['upsertAccessPoint','listSavedRoutes','createSavedRoute','saveSavedRoute','setActiveSavedRoute','setSelectedBusRoute']) if (!repository.includes(text)) failures.push('repository missing ' + text);
if (!manual.includes('destinationAccessPointIds') || !manual.includes('originAccessPointIds')) failures.push('saved route multi-access read missing');
for (const text of ['addRouteOriginAccess','removeRouteOriginAccess','addRouteDestinationAccess','removeRouteDestinationAccess']) if (!service.includes(text)) failures.push('saved route multi-access action missing ' + text);
for (const text of ['class PlaceService','class CommuteService','class TransitSearchService','class BusRouteService','nearby(','listRoutes(']) if (!service.includes(text)) failures.push('service missing ' + text);
for (const text of ['routeMatchesAccessPoint','originConfiguredPoints.some','destinationConfiguredPoints.some','viaConfiguredPoints.every','matchesPreference: true',"policyLabels: ['선택 교통 반영']"]) if (!providerRuntime.includes(text)) failures.push('saved-route provider matching missing ' + text);
if (!selectors.includes('(b.preferenceMatchScore ?? 0) - (a.preferenceMatchScore ?? 0)')) failures.push('route ranking does not prioritize multi-access match score');
if (!manual.includes('aria-label="경유 교통수단 순서 이동"')) failures.push('manual reorder aria label missing');
if (manifest.includes('/commute/edit') || manifest.includes('/access/bus')) failures.push('prototype route aliases leaked into canonical manifest');
for (const text of ['.commute-page .route-candidate','.commute-page .transit-row','.commute-page .bus-route-option','.commute-page .kakao-transit-map-shell','.commute-page .saved-route-setting']) if (!css.includes(text)) failures.push('commute styles missing ' + text);

for (const [name, source] of [['place', place], ['route', route], ['manual', manual], ['access', access], ['bus', bus]]) {
  if (source.includes('/mocks/') || source.includes('/providers/')) failures.push(name + ' imports infrastructure');
  if (source.includes('contracts/repositories')) failures.push(name + ' imports repositories');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 4E multi-route map-first commute workflow verification passed');
