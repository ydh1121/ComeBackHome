import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = 'https://come-back-home.pages.dev';
const json = async (path, options = {}) => {
  const response = await fetch(BASE + path, {
    cache: 'no-store',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    ...options,
  });
  assert.ok(response.ok, 'Canonical API request failed: ' + response.status + ' ' + options.method);
  return response.json();
};
const pathFor = (personId, kind) =>
  '/api/people/' + encodeURIComponent(personId) + '/commute?kind=' + kind;
const stateFor = async (personId, kind) =>
  (await json(pathFor(personId, kind))).accessPoints ?? [];
const selectedSet = (points) => points.filter((p) => p.selected).map((p) => p.id).sort();
const equal = (left, right, label) =>
  assert.deepEqual(left, right, label);
const toggle = async (id, selected) =>
  json('/api/commute/access/' + encodeURIComponent(id), {
    method: 'PATCH',
    body: JSON.stringify({ selected }),
  });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
let restoreError = null;
let personId = null;
const original = new Map();
const report = { canonical: BASE, productionWrite: true, originalRestored: false, origin: 'NOT_RUN', destination: 'NOT_RUN' };
const modified = new Map();
try {
  const people = (await json('/api/people')).people ?? [];
  let pair = null;
  for (const person of people) {
    const [origin, destination] = await Promise.all([
      stateFor(person.id, 'origin'), stateFor(person.id, 'destination'),
    ]);
    if (origin.length >= 1 && destination.length >= 1) {
      personId = person.id;
      pair = { origin, destination };
      break;
    }
  }
  assert.ok(pair, 'Cannot safely run reversible E2E: no single person has existing access points on both sides. No mutation performed.');
  original.set('origin', pair.origin);
  original.set('destination', pair.destination);

  async function browserCount(kind, expected) {
    const path = '/people/' + encodeURIComponent(personId) + '/commute/' + kind + '/access';
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction((count) =>
      document.querySelectorAll('.transit-selected-chip').length === count,
      expected, { timeout: 25000 });
    assert.equal(await page.locator('.transit-selected-chip').count(), expected);
  }
  // Cover both directions of a selected state transition using an existing
  // D1 row only. No new person, stop, route or D1 row is created.
  for (const kind of ['origin','destination']) {
    const point = original.get(kind)[0];
    const initiallySelected = Boolean(point.selected);
    const before = selectedSet(original.get(kind));
    const otherKind = kind === 'origin' ? 'destination' : 'origin';
    const otherBefore = selectedSet(original.get(otherKind));
    await browserCount(kind, before.length);
    modified.set(point.id, initiallySelected);
    try {
      for (const desired of [!initiallySelected, initiallySelected]) {
        await toggle(point.id, desired);
        const now = await stateFor(personId, kind);
        assert.equal(now.find((p) => p.id === point.id)?.selected, desired,
          'D1 write/readback did not reflect toggled selection');
        const expectedIds = before.filter((id) => id !== point.id);
        if (desired) expectedIds.push(point.id);
        equal(selectedSet(now), expectedIds.sort(),
          'D1 side-specific multi-select set mismatch');
        equal(selectedSet(await stateFor(personId, otherKind)), otherBefore,
          'Origin/destination isolation violated');
        await browserCount(kind, expectedIds.length);
      }
      report[kind] = 'PASS_ADD_REMOVE_API_D1_AND_RELOAD';
    } finally {
      // Fail-safe: preserve the original value even on assertion/timeout.
      await toggle(point.id, initiallySelected);
    }
  }
} finally {
  if (personId) {
    for (const [pointId, value] of modified) {
      try { await toggle(pointId, value); }
      catch { restoreError = 'RESTORE_API_WRITE_FAILED'; }
    }
    for (const kind of ['origin','destination']) {
      if (!original.has(kind)) continue;
      try {
        equal(selectedSet(await stateFor(personId, kind)),
          selectedSet(original.get(kind)), 'final D1 selection differs from baseline: ' + kind);
      } catch { restoreError = 'BASELINE_MISMATCH'; }
    }
  }
  await browser.close();
}
report.originalRestored = !restoreError;
console.log(JSON.stringify(report));
assert.ok(report.originalRestored, 'CRITICAL: QA left production selection flags changed: ' + restoreError);
assert.equal(report.origin, 'PASS_ADD_REMOVE_API_D1_AND_RELOAD');
assert.equal(report.destination, 'PASS_ADD_REMOVE_API_D1_AND_RELOAD');
