import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const ORIGIN = 'https://come-back-home.pages.dev';
if (process.env.CBH_REVERSIBLE_PRODUCTION_QA !== 'APPROVED_ONE_RUN') {
  throw new Error('Reversible live D1 verification requires an explicit one-run gate');
}
const browser = await chromium.launch({ headless: true });
const api = await browser.newContext({ baseURL: ORIGIN });
const page = await api.newPage();
const outcomes = [];
let identity = null;
const original = new Map();
const mutations = new Set();

async function json(path) {
  const response = await api.request.get(path);
  assert.equal(response.status(), 200, 'Canonical GET failed: ' + path.split('?')[0].replace(/\/[0-9a-f-]{36}/ig, '/<id>'));
  return response.json();
}
async function snapshot(id, kind) {
  const path = '/api/people/' + encodeURIComponent(id) + '/commute?kind=' + kind;
  const response = await api.request.get(path, {
    headers: { 'Cache-Control': 'no-cache' },
  });
  assert.equal(response.status(), 200, 'Canonical selected-set GET failed');
  return (await response.json()).accessPoints ?? [];
}
// Await observed D1 state rather than the first possibly stale read replica.
// Expose only side/status/timing; never log actual person/stop identifiers.
async function awaitFlag(personId, kind, pointId, expected, label, timeoutMs = 16000) {
  const start = Date.now();
  let lastValue = null;
  let attempts = 0;
  while (Date.now() - start < timeoutMs) {
    const rows = await snapshot(personId, kind);
    lastValue = rows.find(row => row.id === pointId)?.selected ?? null;
    attempts++;
    if (lastValue === expected) return { attempts, durationMs: Date.now() - start };
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  throw new Error(label + ': selected flag never stabilized; side=' + kind +
    ' expected=' + expected + ' last=' + lastValue + ' reads=' + attempts);
}
const key = (point) => point.id;
const flags = (rows) => new Map(rows.map(row => [key(row), Boolean(row.selected)]));
function equalFlags(actual, expected, label) {
  assert.deepEqual([...flags(actual)].sort(), [...flags(expected)].sort(), label);
}
async function restore() {
  if (!identity) return;
  const errors = [];
  for (const kind of ['origin', 'destination']) {
    const baseline = original.get(kind) ?? [];
    const live = await snapshot(identity, kind).catch(() => null);
    if (!live) { errors.push(kind + ': unavailable readback'); continue; }
    for (const point of baseline) {
      const latest = live.find(row => row.id === point.id);
      if (!latest) { errors.push(kind + ': baseline row missing'); continue; }
      if (Boolean(latest.selected) !== Boolean(point.selected)) {
        const patch = await api.request.patch('/api/commute/access/' + encodeURIComponent(point.id), {
          data: { selected: Boolean(point.selected) },
        }).catch(() => null);
        if (!patch?.ok()) errors.push(kind + ': failed to restore selected flag');
      }
    }
    const readback = await snapshot(identity, kind).catch(() => null);
    if (!readback) errors.push(kind + ': cleanup readback unavailable');
    else try { equalFlags(readback, baseline, kind + ': baseline changed during cleanup'); }
    catch (e) { errors.push(kind + ': cleanup flag mismatch'); }
  }
  if (errors.length) throw new Error('CRITICAL: cleanup verification failed: ' + errors.join('; '));
}
try {
  const people = (await json('/api/people')).people ?? [];
  for (const person of people) {
    const id = person.id;
    const [o, d, op, dp] = await Promise.all([
      snapshot(id, 'origin'), snapshot(id, 'destination'),
      json('/api/people/' + encodeURIComponent(id) + '/places/origin'),
      json('/api/people/' + encodeURIComponent(id) + '/places/destination'),
    ]);
    if (o.length && d.length && op.place?.coordinate && dp.place?.coordinate) {
      identity = id; original.set('origin', o); original.set('destination', d); break;
    }
  }
  if (!identity) throw new Error('BLOCKED: no existing person with both saved places and D1 transit access rows; no mutation attempted');
  const initial = { origin: await snapshot(identity, 'origin'), destination: await snapshot(identity, 'destination') };
  for (const kind of ['origin', 'destination']) {
    await page.goto(ORIGIN + '/people/' + encodeURIComponent(identity) + '/commute/' + kind + '/access',
      { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.locator('[data-page="TransitAccessPicker"]').waitFor({ timeout: 35000 });
    await page.locator('.transit-row[data-provider-id] .transit-row-toggle').first().waitFor({ timeout: 90000 });
    const baseline = initial[kind];
    const otherKind = kind === 'origin' ? 'destination' : 'origin';
    // Prefer an already persisted unselected access: ADD makes the existing
    // 2-selection D1 set reach 3, then REMOVE restores all baseline flags.
    const eligible = baseline.filter(point => typeof point.selected === 'boolean')
      .sort((left, right) => Number(left.selected) - Number(right.selected));
    let chosen = null;
    let control = null;
    for (const point of eligible) {
      const row = page.locator('.transit-row').filter({
        has: page.locator('.transit-row-focus'),
      }).filter({ has: page.locator('[data-nonexistent-test-identity]') });
      void row;
      const selector = '.transit-row[data-provider-id=' + JSON.stringify(point.providerId) + '][data-mode=' +
        JSON.stringify(point.mode) + '] .transit-row-toggle';
      const candidate = page.locator(selector);
      if (await candidate.count() === 1 && await candidate.isVisible()) {
        chosen = point; control = candidate; break;
      }
    }
    if (!chosen || !control) {
      outcomes.push({ side: kind, verdict: 'BLOCKED_NO_VISIBLE_EXISTING_ACCESS' });
      continue;
    }
    const baselineSelectedCount = baseline.filter(p => p.selected).length;
    const expected = !Boolean(chosen.selected);
    const patchResponses = [];
    const onResponse = (response) => {
      if (response.request().method() === 'PATCH' &&
          response.url().includes('/api/commute/access/')) {
        patchResponses.push(response.status());
      }
    };
    page.on('response', onResponse);
    let transitionEvidence;
    try {
      await control.click();
      transitionEvidence = await awaitFlag(identity, kind, chosen.id, expected, 'UI mutation');
      await page.waitForFunction(() =>
        !document.querySelector('.transit-row-toggle:disabled'),
        null, { timeout: 10000 });
    } catch (error) {
      const alert = await page.locator('.search-inline-status[role="alert"]')
        .allTextContents().catch(() => []);
      throw new Error('UI→D1 mutation failed; side=' + kind +
        ' PATCH statuses=' + JSON.stringify(patchResponses) +
        ' UI error count=' + alert.length + ' cause=' +
        (error instanceof Error ? error.message : String(error)));
    } finally {
      page.off('response', onResponse);
    }
    assert.ok(patchResponses.includes(200), 'UI selected-action did not receive a successful PATCH');
    mutations.add(chosen.id);
    const after = await snapshot(identity, kind);
    const otherAfter = await snapshot(identity, otherKind);
    assert.equal(after.find(p => p.id === chosen.id)?.selected, expected, 'D1 selected flag write mismatch');
    assert.equal(after.filter(p => p.selected).length, baselineSelectedCount + (expected ? 1 : -1),
      'D1 selected set count mismatch');
    equalFlags(otherAfter, initial[otherKind], 'Origin/destination isolation was violated');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-page="TransitAccessPicker"]').waitFor({ timeout: 35000 });
    const again = page.locator('.transit-row[data-provider-id=' + JSON.stringify(chosen.providerId) +
      '][data-mode=' + JSON.stringify(chosen.mode) + '] .transit-row-toggle');
    await again.waitFor({ timeout: 35000 });
    assert.equal(await again.getAttribute('aria-pressed'), String(expected),
      'Selected flag was not restored in actual UI after reload');
    await again.click();
    await awaitFlag(identity, kind, chosen.id, Boolean(chosen.selected), 'UI restore');
    equalFlags(await snapshot(identity, kind), baseline, 'D1 selection not restored to starting state');
    equalFlags(await snapshot(identity, otherKind), initial[otherKind], 'Other side changed after restoration');
    outcomes.push({
      side: kind, verdict: 'PASS',
      flow: chosen.selected ? 'REMOVE_ADD' : 'ADD_REMOVE',
      originalCount: baselineSelectedCount,
      temporaryCount: baselineSelectedCount + (expected ? 1 : -1),
      reload: true, isolation: true,
      tripleSelectReached: baselineSelectedCount + (expected ? 1 : -1) >= 3,
      writeReadback: 'D1_FLAG_VERIFIED',
      verificationAttempts: transitionEvidence.attempts,
      patchHTTP: 200,
    });
  }
} finally {
  try { await restore(); }
  finally { await page.close(); await api.close(); await browser.close(); }
}
console.log(JSON.stringify({ test: 'reversible-production-transit-selection', outcomes,
  restored: true, deviceAcceptance: 'NOT_STARTED', privateDataLogged: false }, null, 2));
if (outcomes.length !== 2 || outcomes.some(o => o.verdict !== 'PASS')) process.exit(1);
