import assert from 'node:assert/strict';
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

    // This workflow MUST remain read-only. A marker click now toggles a D1
    // selection, so assert markup and test actual user gestures separately.
    const markerDomCount = await page.locator(
      '.kakao-transit-map area[title^="버스 · "], ' +
      '.kakao-transit-map area[title^="지하철 · "]'
    ).count();
    assert.ok(markerDomCount > 0, 'Kakao marker target DOM missing');

    // Render a local-only selected panel for responsive geometry QA. This
    // does not add a saved transit access or alter production database state.
    await page.evaluate(() => {
      const card = document.createElement('div');
      card.className = 'transit-map-active';
      card.setAttribute('data-test-layout', '1');
      card.innerHTML =
        '<div class="transit-map-active-details">' +
        '<strong>지하철 · 언주역 9호선</strong>' +
        '<small>161m · 도보 약 3분</small></div>' +
        '<button class="cta secondary" type="button">이 교통편 선택</button>';
      document.querySelector('.kakao-transit-map-shell')?.after(card);
    });
    const checkedWidths = [];
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 820 });
      const geometry = await page.locator('[data-test-layout]').evaluate((card) => {
        const text = card.querySelector('strong');
        const details = card.querySelector('.transit-map-active-details');
        const button = card.querySelector('button');
        return {
          panelWidth: card.getBoundingClientRect().width,
          panelHeight: card.getBoundingClientRect().height,
          textWidth: text.getBoundingClientRect().width,
          detailsWidth: details.getBoundingClientRect().width,
          buttonWidth: button.getBoundingClientRect().width,
          overflows: card.scrollWidth > card.clientWidth,
        };
      });
      assert.ok(geometry.panelWidth > 200 && geometry.detailsWidth > 170 &&
        geometry.textWidth > 170 && geometry.panelHeight < 170 &&
        geometry.buttonWidth > 105 && !geometry.overflows,
        'Selected transit layout broken at viewport ' + width + 'px: ' +
          JSON.stringify(geometry));
      checkedWidths.push(width);
    }
    await page.locator('[data-test-layout]').evaluate((node) => node.remove());

    // Simulate actual map drag in a browser, never a state-only unit mock.
    const selectedChipCountBeforePan = await page.locator('.transit-selected-chip').count();
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
      markerInteraction: 'NOT_RUN_READ_ONLY',
      markerListSync: 'NOT_RUN_READ_ONLY',
      mapCenterRequery: label.startsWith('mobile') ? 'NOT_RUN_TOUCH_DRAG' : 'PASS',
      layoutWidths: checkedWidths,
      nearbyDistanceCap: 'PASS',
      nearbyTotal: nearby.length,
      nearbyBusCount: nearby.filter((item) => item.mode === 'BUS').length,
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
