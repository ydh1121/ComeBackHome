import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// This file is never run by push/PR CI. It requires one manual approval,
// validates the local KST freeze boundary and performs at most ONE live call.
// All browser UI requests are fulfilled from the single verified response.
if (process.env.CBH_KAKAO_ROUTE_SMOKE !== 'APPROVED_ONE_RUN') {
  throw new Error('KAKAO_ROUTE_SMOKE_DENIED: requires explicit one-shot approval');
}
if (Date.now() < Date.parse('2026-10-09T00:05:00+09:00')) {
  throw new Error('KAKAO_ROUTE_SMOKE_FROZEN_UNTIL_2026_10_09_0005_KST');
}
const ORIGIN = 'https://come-back-home.pages.dev';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
let actualProviderCalls = 0;
let replayedUiRequests = 0;
const page = await context.newPage();
try {
  // Strict browser egress firewall: no second real routes call is permitted.
  await page.route(/\/api\/providers\/routes(?:\?|$)/, route =>
    route.abort('blockedbyclient'));
  const get = async (path) => {
    const res = await context.request.get(ORIGIN + path, {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
    });
    assert.equal(res.status(), 200, 'Required read-only API request failed: ' + path.split('?')[0]);
    return res.json();
  };
  const people = (await get('/api/people')).people ?? [];
  let selected = null;
  for (const person of people) {
    const [origin, destination] = await Promise.all([
      get('/api/people/' + encodeURIComponent(person.id) + '/places/origin'),
      get('/api/people/' + encodeURIComponent(person.id) + '/places/destination'),
    ]);
    const a = origin.place?.coordinate;
    const b = destination.place?.coordinate;
    if ([a?.x,a?.y,b?.x,b?.y].every(Number.isFinite)) {
      selected = { id: person.id, a, b };
      break;
    }
  }
  assert.ok(selected, 'BLOCKED: saved origin/destination coordinates unavailable');
  const url = new URL(ORIGIN + '/api/providers/routes');
  url.searchParams.set('originX', String(selected.a.x));
  url.searchParams.set('originY', String(selected.a.y));
  url.searchParams.set('destinationX', String(selected.b.x));
  url.searchParams.set('destinationY', String(selected.b.y));

  actualProviderCalls++;
  assert.equal(actualProviderCalls, 1, 'HARD_BUDGET: one live provider request only');
  const response = await context.request.get(url.toString(), {
    headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok()) {
    // Never log provider upstream text, route IDs or personal coordinates.
    const quota = response.status() === 400 &&
      typeof body?.error === 'string' && /HTTP 400 CODE -10(?:$|\s)/.test(body.error);
    throw new Error(quota ? 'KAKAO_ROUTE_QUOTA_BLOCKED' :
      'KAKAO_ROUTE_PROVIDER_HTTP_' + response.status());
  }
  const routes = Array.isArray(body?.results) ? body.results : [];
  assert.ok(routes.length > 0, 'KAKAO_ROUTE_PROVIDER_ZERO_RESULTS');

  // The browser receives the already-fetched provider response. This tests
  // card rendering without a second external route call or saving anything.
  await page.unroute(/\/api\/providers\/routes(?:\?|$)/);
  await page.route(/\/api\/providers\/routes(?:\?|$)/, async (route) => {
    replayedUiRequests++;
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ results: routes }),
    });
  });
  await page.route('**/api/**', async (route) => {
    if (route.request().method() !== 'GET') return route.abort('blockedbyclient');
    return route.continue();
  });
  // Later-added routes win: ensure the provider replay still has precedence.
  await page.unroute(/\/api\/providers\/routes(?:\?|$)/);
  await page.route(/\/api\/providers\/routes(?:\?|$)/, async (route) => {
    replayedUiRequests++;
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ results: routes }),
    });
  });
  await page.goto(ORIGIN + '/people/' + encodeURIComponent(selected.id) + '/commute',
    { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('[data-page="CommuteRouteEditPage"]').waitFor({ timeout: 35000 });
  await page.locator('.route-candidate').first().waitFor({ timeout: 20000 });
  const cards = await page.locator('.route-candidate').count();
  assert.ok(cards > 0, 'Live upstream results did not render into a card');
  console.log(JSON.stringify({
    status: 'MIDNIGHT_ROUTE_SMOKE_PASS',
    source: 'ONE_LIVE_PROVIDER_PLACE_PAIR',
    browser: 'CHROMIUM_CACHED_ROUTE_REPLAY',
    apiResultCount: routes.length,
    uiCardCount: cards,
    actualProviderCalls,
    uiProviderRequestReplays: replayedUiRequests,
    d1Writes: 0, privateValuesLogged: false,
  }));
} finally {
  await context.close();
  await browser.close();
}
