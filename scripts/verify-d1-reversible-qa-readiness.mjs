import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const wf = read('.github/workflows/verify-canonical-transit-writes-once.yml');
const access = read('scripts/verify-canonical-transit-writes-reversible.mjs');
const saved = read('scripts/verify-saved-route-once.mjs');
assert.ok(wf.includes('cbh-reversible-d1-qa.trigger') &&
  wf.includes('CBH_REVERSIBLE_PRODUCTION_QA: APPROVED_ONE_RUN') &&
  wf.includes('CBH_ROUTE_QA: APPROVED_ONE_RUN'), 'Existing one-run QA is unguarded');
assert.ok(wf.indexOf('Verify UI→D1→reload') < wf.indexOf('Verify preferred route→Today/ETA'),
  'Saved route QA must execute only after transit QA returned and restored');
for (const v of [
  'const original = new Map()', "['origin', 'destination']",
  'const mutations = new Set()', 'awaitFlag(', "patchResponses.includes(200)",
  'async function restore()', 'await restore()', 'equalFlags(',
  'otherAfter', 'page.reload', 'await again.click()',
]) assert.ok(access.includes(v), 'Transit reversible QA missing ' + v);
for (const v of [
  "process.env.CBH_ROUTE_QA !== 'APPROVED_ONE_RUN'",
  'let original = null;', 'async function restore()', 'await restore()',
  'preferredRouteCandidateId', 'waitForPreferred(', 'route-candidate',
  'data-selected-route-id', 'data-eta-status', 'originalStateRestored',
]) assert.ok(saved.includes(v), 'Preferred route restoration/Today QA missing ' + v);
assert.ok(!/CF_API_TOKEN|DATABASE_URL|KAKAO_REST_API_KEY/.test(access + saved),
  'Reversible UI-level tests must not read external credentials');
console.log(JSON.stringify({
  result:'READY_BLOCKED_AUTH',
  source: 'STATIC_CONTRACT_ONLY',
  baseline: 'PRESENT',
  originDestinationRoundTrip: 'SOURCE_READY',
  sideIsolation: 'SOURCE_READY',
  reloadReadback: 'SOURCE_READY',
  cleanupVerification: 'SOURCE_READY',
  savedRouteTodayEta: 'SOURCE_READY',
  executedProductionWrites: 0,
  externalApprovalRequired: true,
}));
