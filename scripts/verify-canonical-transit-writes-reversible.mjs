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
  return (await json('/api/people/' + encodeURIComponent(id) + '/commute?kind=' + kind)).accessPoints ?? [];
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
    await control.click();
    await page.waitForFunction(async ({ id, side, selected, personId }) => {
      const response = await fetch('/api/people/' + encodeURIComponent(personId) + '/commute?kind=' + side);
      if (!response.ok) return false;
      const rows = (await response.json()).accessPoints ?? [];
      return rows.find(point => point.id === id)?.selected === selected;
    }, { id: chosen.id, side: kind, selected: expected, personId: identity }, { timeout: 18000 });
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
    await page.waitForFunction(async ({ id, side, selected, personId }) => {
      const response = await fetch('/api/people/' + encodeURIComponent(personId) + '/commute?kind=' + side);
      if (!response.ok) return false;
      return (await response.json()).accessPoints?.find(point => point.id === id)?.selected === selected;
    }, { id: chosen.id, side: kind, selected: Boolean(chosen.selected), personId: identity }, { timeout: 18000 });
    equalFlags(await snapshot(identity, kind), baseline, 'D1 selection not restored to starting state');
    equalFlags(await snapshot(identity, otherKind), initial[otherKind], 'Other side changed after restoration');
    outcomes.push({
      side: kind, verdict: 'PASS',
      flow: chosen.selected ? 'REMOVE_ADD' : 'ADD_REMOVE',
      originalCount: baselineSelectedCount,
      temporaryCount: baselineSelectedCount + (expected ? 1 : -1),
      reload: true, isolation: true,
      tripleSelectReached: baselineSelectedCount + (expected ? 1 : -1) >= 3,
    });
  }
} finally {
  try { await restore(); }
  finally { await page.close(); await api.close(); await browser.close(); }
}
console.log(JSON.stringify({ test: 'reversible-production-transit-selection', outcomes,
  restored: true, deviceAcceptance: 'NOT_STARTED', privateDataLogged: false }, null, 2));
if (outcomes.length !== 2 || outcomes.some(o => o.verdict !== 'PASS')) process.exit(1);
