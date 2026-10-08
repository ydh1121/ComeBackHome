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
    for (const person of people) {
      const response = await api.get(
        ORIGIN + '/api/people/' + encodeURIComponent(person.id) + '/places/origin'
      );
      const place = response.ok() ? (await response.json()).place : null;
      if (place?.coordinate && Number.isFinite(place.coordinate.x) &&
          Number.isFinite(place.coordinate.y)) {
        target = person.id;
        break;
      }
    }
    assert.ok(target, 'No person with a persisted origin coordinate');
    const pathId = encodeURIComponent(target);
    const page = await context.newPage();
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

    results.push({
      browser: label,
      mapSDK: 'PASS',
      mapDOM: 'PASS',
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
