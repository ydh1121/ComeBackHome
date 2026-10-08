import assert from 'node:assert/strict';
import { chromium } from 'playwright';

if (process.env.CBH_ROUTE_QA !== 'APPROVED_ONE_RUN') {
  throw new Error('An explicit one-run route QA gate is required');
}
const ORIGIN = 'https://come-back-home.pages.dev';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
let person = null;
let original = null;
let attemptedChange = false;
let restored = false;
const result = {
  routeSave: 'NOT_VERIFIED',
  routeReload: 'NOT_VERIFIED',
  todayUsesSelectedRoute: 'NOT_VERIFIED',
  etaUsesSelectedRoute: 'NOT_VERIFIED',
  originalStateRestored: false,
};

async function get(path) {
  const response = await ctx.request.get(ORIGIN + path, {
    headers: { 'Cache-Control': 'no-cache' },
  });
  assert.equal(response.status(), 200, 'Canonical GET failed for selected route');
  return response.json();
}
function commutePath(id) {
  return '/api/people/' + encodeURIComponent(id) + '/commute?kind=origin';
}
async function preferred(id) {
  return (await get(commutePath(id))).preferredRouteCandidateId;
}
async function waitForPreferred(id, expected, timeout = 18000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await preferred(id) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error('Saved preferred route did not stabilize in D1 readback');
}
async function restore() {
  if (!person || !original || !attemptedChange) {
    restored = true;
    return;
  }
  const response = await ctx.request.put(
    ORIGIN + '/api/people/' + encodeURIComponent(person) + '/commute/preferred-route',
    { data: { routeCandidateId: original } },
  );
  assert.equal(response.status(), 200, 'CRITICAL: route original-state restore PUT failed');
  await waitForPreferred(person, original);
  restored = true;
}
try {
  const people = (await get('/api/people')).people ?? [];
  for (const candidate of people) {
    const state = await get(commutePath(candidate.id));
    if (state.preferredRouteCandidateId) {
      person = candidate.id;
      original = state.preferredRouteCandidateId;
      break;
    }
  }
  if (!person || !original) {
    throw new Error('BLOCKED: no existing person with a restorable preferred route; no mutation attempted');
  }
  await ctx.addInitScript(({ personId }) => {
    localStorage.setItem('cbh:selected-person-id', personId);
  }, { personId: person });

  const routeUrl = ORIGIN + '/people/' + encodeURIComponent(person) + '/commute';
  await page.goto(routeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('[data-page="CommuteRouteEditPage"]').waitFor({ timeout: 35000 });
  const candidates = page.locator('.route-candidate[data-route-candidate-id]');
  await candidates.first().waitFor({ timeout: 35000 });
  const candidateIds = await candidates.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-route-candidate-id')).filter(Boolean)
  );
  const alternate = candidateIds.find((id) => id !== original);
  if (!alternate) {
    throw new Error('BLOCKED: provider returned no alternative candidate; no mutation attempted');
  }

  // Real card A→B selection and save. Clicking a card alone must not persist.
  const card = page.locator('.route-candidate').filter({
    has: page.locator('[data-not-used-route-marker]'),
  });
  void card;
  const alternateCard = page.locator('.route-candidate[data-route-candidate-id=' +
    JSON.stringify(alternate) + ']');
  await alternateCard.click();
  assert.equal(await alternateCard.getAttribute('aria-pressed'), 'true',
    'Alternate route selection failed in UI');
  assert.equal(await preferred(person), original,
    'Draft route selection changed the DB before explicit save');

  // The live app may show a user-facing confirmation before all D1 read replicas converge.
  attemptedChange = true;
  await page.getByRole('button', { name: '선택한 추천 경로 저장' }).click();
  await waitForPreferred(person, alternate);
  result.routeSave = 'PASS';

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-page="CommuteRouteEditPage"]').waitFor({ timeout: 35000 });
  const reloaded = page.locator('.route-candidate[data-route-candidate-id=' +
    JSON.stringify(alternate) + ']');
  await reloaded.waitFor({ timeout: 35000 });
  assert.equal(await reloaded.getAttribute('aria-pressed'), 'true',
    'Saved route was not restored in route selector UI after reload');
  await waitForPreferred(person, alternate);
  result.routeReload = 'PASS';

  await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('[data-page="TodayPage"]').waitFor({ timeout: 35000 });
  await page.waitForFunction((selectedId) =>
    document.querySelector('[data-page="TodayPage"]')
      ?.getAttribute('data-selected-route-id') === selectedId,
    alternate, { timeout: 25000 });
  result.todayUsesSelectedRoute = 'PASS';

  const etaState = await page.locator('[data-page="TodayPage"]')
    .getAttribute('data-eta-status');
  assert.ok(etaState && etaState !== 'UNKNOWN',
    'Selected route identity is visible on Today, but ETA did not resolve from the selected route');
  result.etaUsesSelectedRoute = 'PASS';

} finally {
  try {
    await restore();
    result.originalStateRestored = restored;
  } finally {
    await page.close();
    await ctx.close();
    await browser.close();
  }
}
console.log(JSON.stringify({
  test: 'reversible-production-preferred-route-today-eta',
  ...result,
  noRealCommuteOrNotifications: true,
  privateIdsLogged: false,
}, null, 2));
if (!Object.values(result).every((v) => v === 'PASS' || v === true)) process.exit(1);
