import assert from 'node:assert/strict';
import { chromium } from 'playwright';
if (process.env.CBH_ROUTE_QA !== 'APPROVED_ONE_RUN') throw Error('No one-run route QA permission');
const origin = 'https://come-back-home.pages.dev';
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
let person = null, original = null, alternate = null, restored = false;
const results = { save: 'NOT_VERIFIED', reload: 'NOT_VERIFIED', today: 'NOT_VERIFIED', eta: 'NOT_VERIFIED' };
async function get(path) {
  const r = await ctx.request.get(origin + path);
  assert.equal(r.status(), 200, 'Canonical GET status');
  return r.json();
}
const pathFor = id => '/api/people/' + encodeURIComponent(id) + '/commute?kind=origin';
async function preferred() { return (await get(pathFor(person))).preferredRouteCandidateId; }
async function restore() {
  if (!person || !original) { restored = true; return; }
  if (await preferred() !== original) {
    const r = await ctx.request.put(origin + '/api/people/' + encodeURIComponent(person) +
      '/commute/preferred-route', { data: { routeCandidateId: original } });
    assert.equal(r.status(), 200, 'CRITICAL: route cleanup PUT failed');
  }
  assert.equal(await preferred(), original, 'CRITICAL: route cleanup readback mismatch');
  restored = true;
}
