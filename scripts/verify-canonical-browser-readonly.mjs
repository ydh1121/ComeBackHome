import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, webkit, devices } from 'playwright';

const ORIGIN = 'https://come-back-home.pages.dev';
const failures = [];
const results = [];

async function verifyOn(browserType, label, device = {}) {
  const browser = await browserType.launch({ headless: true });
  let context;
  try {
    context = await browser.newContext({
      ...device,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    });
    const api = context.request;
    const configResponse = await api.get(ORIGIN + '/api/client-config');
    assert.equal(configResponse.status(), 200, 'canonical client config HTTP status');
    const config = await configResponse.json();
    assert.equal(config?.kakaoMaps?.configured, true, 'Maps config must be active');
    assert.ok(String(config?.kakaoMaps?.javaScriptKey ?? '').length >= 8,
      'Browser Maps JavaScript key missing');

    const peopleResponse = await api.get(ORIGIN + '/api/people');
    assert.equal(peopleResponse.status(), 200, 'canonical people API HTTP status');
    const people = (await peopleResponse.json()).people ?? [];
    assert.ok(people.length, 'No canonical person available for read-only QA');
    let target = null;
    let originCoordinate = null;
    for (const person of people) {
      const response = await api.get(
        ORIGIN + '/api/people/' + encodeURIComponent(person.id) + '/places/origin'
      );
      const place = response.ok() ? (await response.json()).place : null;
      if (place?.coordinate && Number.isFinite(place.coordinate.x) &&
          Number.isFinite(place.coordinate.y)) {
        target = person.id;
        originCoordinate = place.coordinate;
        break;
      }
    }
    assert.ok(target, 'No person with a persisted origin coordinate');
    const pathId = encodeURIComponent(target);
    const proximityUrl = new URL(ORIGIN + '/api/providers/transit-nearby');
    proximityUrl.searchParams.set('x', String(originCoordinate.x));
    proximityUrl.searchParams.set('y', String(originCoordinate.y));
    const nearbyResponse = await api.get(proximityUrl.toString());
    assert.equal(nearbyResponse.status(), 200, 'canonical nearby transit endpoint');
    const nearbyPayload = await nearbyResponse.json();
    const nearby = nearbyPayload.results ?? [];
    assert.ok(nearby.length, 'No nearby transit candidates for saved origin');
    assert.ok(nearby.every((item) => Number.isFinite(item.distanceM) &&
      item.distanceM <= (item.mode === 'BUS' ? 800 : 900)),
      'Multi-km transit outlier leaked into normal nearby list');
    assert.ok(nearby.every((item, index) => index === 0 ||
      nearby[index - 1].distanceM <= item.distanceM),
      'Nearby transit candidates not sorted by distance');
    assert.ok(nearby.filter((item) => item.mode === 'BUS').every((item) =>
      item.providerId && (
        item.id.startsWith('seoul-bus:') ? Boolean(item.displayCode) :
          item.id.startsWith('kakao-transit:bus:')
      )),
      'Nearby bus lacks an official station ID or strict category provenance');
    assert.ok(nearby.some((item) => item.mode === 'BUS'),
      'Nearby bus discovery returned no candidate; source=' +
        (nearbyPayload.sourceStatus?.bus ?? 'UNKNOWN'));

    const page = await context.newPage();
    const attemptedWrites = [];
    await page.route('**/api/**', async (route) => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
        attemptedWrites.push(route.request().method());
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });
    const javascriptErrors = [];
    page.on('pageerror', (error) => javascriptErrors.push(error.name ?? 'Error'));

    const mapPath = ORIGIN + '/people/' + pathId + '/commute/origin/access';
    await page.goto(mapPath, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.locator('[data-page="TransitAccessPicker"]').waitFor({ timeout: 35_000 });
    await page.locator('[data-map-state="ready"]').waitFor({ timeout: 35_000 });
    const renderedMap = await page.locator('.kakao-transit-map').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        hasRenderedChildren: element.children.length > 0,
        dimensionsValid: rect.width > 100 && rect.height > 100,
        sdkReady: Boolean(window.kakao?.maps?.Map),
      };
    });
    assert.equal(renderedMap.sdkReady, true, 'Kakao Maps SDK not initialized');
    assert.equal(renderedMap.dimensionsValid, true, 'Interactive map dimensions invalid');
    assert.equal(renderedMap.hasRenderedChildren, true, 'Interactive map DOM not rendered');

    // Actual screenshot-equivalent QA: activate a REAL Kakao marker and
    // inspect the rendered React panel. No manually injected fake card.
    const markerTargets = page.locator(
      '.kakao-transit-map area[title^="버스 · "], ' +
      '.kakao-transit-map area[title^="지하철 · "]'
    );
    await markerTargets.first().waitFor({ state: 'attached', timeout: 20_000 });
    const markerTitles = await markerTargets.evaluateAll((nodes) =>
      nodes.map((node, index) => ({
        index,
        name: node.getAttribute('title') ?? '',
      }))
    );
    assert.ok(markerTitles.length, 'Kakao transit markers are not rendered');
    const preferred = markerTitles.find((item) => item.name.includes('차병원사거리')) ??
      markerTitles.sort((a, b) => b.name.length - a.name.length)[0];
    const marker = markerTargets.nth(preferred.index);
    const markerClick = await marker.evaluate((area) => {
      const map = area.closest('map');
      const name = map?.getAttribute('name') ?? map?.id ?? '';
      const image = [...document.querySelectorAll('img[usemap]')].find((candidate) =>
        candidate.getAttribute('usemap')?.replace(/^#/, '') === name);
      const coords = (area.getAttribute('coords') ?? '').split(',')
        .map(Number).filter(Number.isFinite);
      const imageBox = image?.getBoundingClientRect();
      if (!image || !imageBox || coords.length < 4 ||
          imageBox.width < 4 || imageBox.height < 4) {
        return { type: 'DOM_CLICK', name: area.getAttribute('title') ?? '' };
      }
      const xs = coords.filter((_, index) => index % 2 === 0);
      const ys = coords.filter((_, index) => index % 2 === 1);
      const naturalWidth = image.naturalWidth || image.width;
      const naturalHeight = image.naturalHeight || image.height;
      const x = imageBox.left + (Math.min(...xs) + Math.max(...xs)) / 2 *
        (imageBox.width / naturalWidth);
      const y = imageBox.top + (Math.min(...ys) + Math.max(...ys)) / 2 *
        (imageBox.height / naturalHeight);
      return { type: 'POINTER', x, y, name: area.getAttribute('title') ?? '' };
    });
    if (markerClick.type === 'POINTER') {
      if (label.startsWith('mobile')) {
        await page.touchscreen.tap(markerClick.x, markerClick.y);
      } else {
        await page.mouse.click(markerClick.x, markerClick.y);
      }
    } else {
      // The polygon-area target is occasionally unpositioned in WebKit
      // headless. This is DOM activation only, NOT physical-tap acceptance.
      await marker.evaluate((area) => area.click());
    }
    const activePanel = page.getByRole('region', { name: '지도에서 선택한 교통편' });
    await activePanel.waitFor({ timeout: 10_000 });
    const activeName = markerClick.name.replace(/^(버스|지하철) · /, '');
    assert.ok((await activePanel.innerText()).includes(activeName),
      'Live active transit panel did not match focused marker');
    assert.ok((await page.locator('.transit-row.map-active').innerText()).includes(activeName),
      'Active map marker did not highlight the same entity in the list');
    assert.equal(attemptedWrites.length, 0,
      'Focusing a map marker must not mutate production D1');

    const checkedWidths = [];
    const measured = [];
    mkdirSync('artifacts/cbh-transit-card', { recursive: true });
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 820 });
      const geometry = await page.locator('.transit-map-active').evaluate((card) => {
        const panel = card.getBoundingClientRect();
        const name = card.querySelector('.transit-active-name');
        const nameBox = name?.getBoundingClientRect();
        const action = card.querySelector('.transit-active-action');
        const actionBox = action?.getBoundingClientRect();
        const filterBox = document.querySelector('.candidate-filter')?.getBoundingClientRect();
        const searchBox = document.querySelector('.transit-inline-search')?.getBoundingClientRect();
        const summaryBox = document.querySelector('.transit-selected-summary')?.getBoundingClientRect();
        const firstRow = document.querySelector('.transit-row')?.getBoundingClientRect();
        const lineHeight = name ? parseFloat(getComputedStyle(name).lineHeight) : 0;
        return {
          panelWidth: panel.width, panelHeight: panel.height,
          nameWidth: nameBox?.width ?? 0,
          nameLines: nameBox && lineHeight ? Math.round(nameBox.height / lineHeight) : 0,
          actionWidth: actionBox?.width ?? 0,
          actionVisible: Boolean(actionBox && actionBox.width > 40 && actionBox.height >= 32),
          verticalGap: filterBox ? Math.round(filterBox.top - panel.bottom) : -1,
          filterChipCount: document.querySelectorAll('.candidate-filter .filter-btn').length,
          searchGap: filterBox && searchBox ? Math.round(searchBox.top - filterBox.bottom) : -1,
          summaryGap: searchBox && summaryBox ? Math.round(summaryBox.top - searchBox.bottom) : null,
          resultGap: summaryBox && firstRow ? Math.round(firstRow.top - summaryBox.bottom) : null,
          overflow: card.scrollWidth > card.clientWidth + 1,
        };
      });
      assert.ok(geometry.panelWidth > 220 && geometry.nameWidth >= 138 &&
        geometry.nameLines >= 1 && geometry.nameLines <= 3 &&
        geometry.panelHeight <= 128 && geometry.actionVisible && !geometry.overflow &&
        geometry.verticalGap >= 12 && geometry.verticalGap <= 24 &&
        geometry.filterChipCount === 3 && geometry.searchGap >= 6,
        'Actual selected card geometry failed at ' + width + 'px: ' +
          JSON.stringify(geometry));
      measured.push({ width, ...geometry });
      checkedWidths.push(width);
      if (width === 375 || width === 390) {
        await activePanel.scrollIntoViewIfNeeded();
        const cardBox = await activePanel.boundingBox();
        const summaryBox = await page.locator('.transit-selected-summary').boundingBox();
        if (cardBox) {
          // Crop BELOW the map: no private saved-place context is stored.
          await page.screenshot({
            path: 'artifacts/cbh-transit-card/' + label + '-' + width + '.png',
            clip: {
              x: Math.max(0, cardBox.x - 1),
              y: Math.max(0, cardBox.y - 1),
              width: Math.ceil(cardBox.width + 2),
              height: Math.ceil(Math.min(
                470, Math.max(200, (summaryBox?.y ?? (cardBox.y + 260)) -
                  cardBox.y + (summaryBox?.height ?? 50) + 12)
              )),
            },
          });
        }
      }
    }
    const savedAccessResponse = await api.get(
      ORIGIN + '/api/people/' + pathId + '/commute?kind=origin'
    );
    assert.equal(savedAccessResponse.status(), 200, 'D1 origin access readback');
    const savedOriginPoints = (await savedAccessResponse.json()).accessPoints ?? [];
    const selectedOriginCount = savedOriginPoints.filter((point) => point.selected === true).length;
    const selectedChipCountBeforePan = await page.locator('.transit-selected-chip').count();
    assert.equal(selectedChipCountBeforePan, selectedOriginCount,
      'Standalone picker selection count differs from persisted D1 flags');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-map-state="ready"]').waitFor({ timeout: 35_000 });
    assert.equal(await page.locator('.transit-selected-chip').count(), selectedOriginCount,
      'Saved selection count not restored after real browser reload');

    // Simulate actual map drag in a browser, never a state-only unit mock.
    const mapBox = await page.locator('.kakao-transit-map').boundingBox();
    assert.ok(mapBox, 'Interactive map has no drag target');
    const startX = mapBox.x + mapBox.width * 0.65;
    const startY = mapBox.y + mapBox.height * 0.45;
    if (!label.startsWith('mobile')) {
      const dragResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === '/api/providers/transit-nearby' &&
          url.searchParams.get('x') !== String(originCoordinate.x) &&
          response.request().method() === 'GET';
      }, { timeout: 25_000 });
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX - 110, startY - 55, { steps: 12 });
      await page.mouse.up();
      const draggedResponse = await dragResponse;
      assert.equal(draggedResponse.status(), 200, 'map-center requery failed');
      await page.waitForTimeout(450);
      assert.equal(await page.locator('.transit-selected-chip').count(),
        selectedChipCountBeforePan,
        'Map pan cleared previously stored transit selections');
      const unchangedPlace = await api.get(
        ORIGIN + '/api/people/' + pathId + '/places/origin'
      );
      assert.equal(unchangedPlace.status(), 200, 'saved place readback after pan');
      const anchorAfterPan = (await unchangedPlace.json()).place?.coordinate;
      assert.deepEqual(anchorAfterPan, originCoordinate,
        'Map pan must never mutate saved origin coordinates');
    }

    const input = page.locator('.transit-inline-search input[type="search"]');
    const transitResponseWait = page.waitForResponse(
      (response) => response.url().includes('/api/providers/transit-search') &&
        response.request().method() === 'GET',
      { timeout: 35_000 },
    );
    await input.fill('언주역');
    const transitResponse = await transitResponseWait;
    assert.equal(transitResponse.status(), 200, 'transit-only search HTTP status');
    const transitResults = (await transitResponse.json()).results ?? [];
    assert.ok(transitResults.length, '언주역 transit search unexpectedly empty');
    assert.ok(transitResults.every((item) => item.mode === 'BUS' || item.mode === 'SUBWAY'),
      'Non-transit POI leaked into transit API results');
    assert.ok(!transitResults.some((item) =>
      /떡볶이|라운지|피트니스|미용실|헬스|카페|코스메틱/.test(item.name ?? '')),
      'General business leaked into transit results');
    await page.locator('.transit-row').first().waitFor({ timeout: 12_000 });

    await page.goto(ORIGIN + '/people/' + pathId + '/place/origin',
      { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const placeInput = page.locator('.address-search-control input');
    await placeInput.fill('코엑스');
    await page.locator('.search-result-row').first().waitFor({ timeout: 25_000 });

    await page.goto(ORIGIN + '/people/' + pathId + '/commute',
      { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.locator('[data-page="CommuteRouteEditPage"]').waitFor({ timeout: 30_000 });
    const routeCards = page.locator('.route-candidate');
    await routeCards.first().waitFor({ timeout: 25_000 });
    const candidates = await routeCards.count();
    assert.ok(candidates >= 2, 'Cannot verify route A -> B: fewer than two candidates');
    await routeCards.nth(1).click();
    assert.equal(await routeCards.nth(1).getAttribute('aria-pressed'), 'true',
      'Second recommended route was not selected');
    assert.equal(await routeCards.first().getAttribute('aria-pressed'), 'false',
      'Previous recommended route remained selected');
    await page.getByRole('button', { name: '선택한 추천 경로 저장' })
      .waitFor({ timeout: 10_000 });

    assert.equal(attemptedWrites.length, 0,
      'Read-only QA unexpectedly attempted production mutations');
    results.push({
      browser: label,
      mapSDK: 'PASS',
      mapDOM: 'PASS',
      mapMarkerDOM: 'PASS',
      markerInteraction: markerClick.type === 'POINTER' ? 'POINTER_PREVIEW_PASS' : 'DOM_PREVIEW_PASS',
      markerListSync: 'FOCUS_ONLY_PASS',
      realActiveCard: 'PASS',
      activeCardGeometry: measured,
      mapCenterRequery: label.startsWith('mobile') ? 'NOT_RUN_TOUCH_DRAG' : 'PASS',
      layoutWidths: checkedWidths,
      nearbyDistanceCap: 'PASS',
      nearbyTotal: nearby.length,
      nearbyBusCount: nearby.filter((item) => item.mode === 'BUS').length,
      originPersistedSelectionCount: selectedOriginCount,
      persistedSelectionReload: 'PASS_READ_ONLY',
      busSource: nearbyPayload.sourceStatus?.bus ?? 'UNKNOWN',
      nearbySubwayCount: nearby.filter((item) => item.mode === 'SUBWAY').length,
      nearbyMaximumMeters: Math.max(...nearby.map((item) => item.distanceM)),
      transitOnly: 'PASS',
      transitCount: transitResults.length,
      placeBusiness: 'PASS',
      routeDraftSelection: 'PASS',
      productionWrites: 0,
      javascriptErrors: javascriptErrors.length,
      sensitiveValuesLogged: false,
    });
  } catch (error) {
    failures.push(label + ': ' + (error instanceof Error ? error.message : String(error)));
  } finally {
    await context?.close();
    await browser.close();
  }
}

await verifyOn(chromium, 'desktop-chromium', { viewport: { width: 1365, height: 900 } });
await verifyOn(webkit, 'mobile-webkit-emulation', devices['iPhone 13']);

console.log(JSON.stringify({ results, failures, readOnly: true }, null, 2));
if (failures.length) process.exit(1);
