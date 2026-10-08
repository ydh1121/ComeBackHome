import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const browser = read('scripts/verify-canonical-browser-readonly.mjs');
const browserWorkflow = read('.github/workflows/verify-canonical-browser-readonly.yml');
const oneShot = read('scripts/verify-kakao-route-one-shot.mjs');
const manualWorkflow = read('.github/workflows/verify-pages-transit-runtime.yml');
const localWorkflow = read('.github/workflows/phase5g-local-integration.yml');
const routeRuntime = read('src/providers/runtime/ProviderRuntimeRepositories.ts');
const providerE2e = read('scripts/verify-phase5o-provider-e2e.mjs');
const api = read('worker/api.ts');
const generator = read('scripts/generate-build-revision.mjs');

assert.ok(browser.includes('fixtureRouteRequests++'), 'browser regression is missing fixture routing');
assert.ok(browser.includes("placePairStatus = 'SKIPPED_QUOTA_FIREWALL'"),
  'browser regression still performs live place-pair smoke');
assert.ok(!browser.includes('api.get(u.toString())'), 'browser regression contains live direct provider fetch');
assert.ok(browser.includes("route.fulfill("), 'browser fixture must intercept route requests');
assert.ok(browser.includes("serviceWorkers: 'block'") &&
  browser.includes('context.addInitScript(') && browser.includes("window.fetch ="),
  'Canonical PWA fixture must block service-worker bypass and intercept fetch');
assert.ok(browserWorkflow.includes('workflow_dispatch:') &&
  !/\n  push:|\n  pull_request:/.test(browserWorkflow),
  'Canonical browser QA must not auto-run while quota is frozen');
assert.ok(!browserWorkflow.includes('CBH_KAKAO_ROUTE_SMOKE: APPROVED_ONE_RUN'),
  'normal browser CI must not approve live routes');
assert.ok(!localWorkflow.includes('CBH_KAKAO_ROUTE_SMOKE: APPROVED_ONE_RUN'),
  'standard CI must not approve live routes');
assert.ok(providerE2e.includes('fakeTransport') || providerE2e.includes('providerRuntime'),
  'provider E2E must use local source stubs');
assert.ok(manualWorkflow.includes('workflow_dispatch:') &&
  !/\n  push:|\n  pull_request:/.test(manualWorkflow),
  'one-shot provider workflow must not run on push or PR');
assert.ok(manualWorkflow.includes("inputs.route_smoke == 'APPROVED_ONE_RUN'"),
  'one-shot provider workflow missing explicit manual approval');
assert.ok(oneShot.includes("process.env.CBH_KAKAO_ROUTE_SMOKE !== 'APPROVED_ONE_RUN'") &&
  oneShot.includes("2026-10-09T00:05:00+09:00"),
  'one-shot pre-midnight or missing-approval denial missing');
assert.ok(oneShot.includes("assert.equal(actualProviderCalls, 1") &&
  !oneShot.includes('for (let attempt'),
  'one-shot provider hard budget must remain one call, no retries');
assert.ok(oneShot.includes("serviceWorkers: 'block'") &&
  oneShot.includes('context.addInitScript('),
  'One-shot must replay cached results even when browser fetch/SW would otherwise bypass routing');
assert.ok(oneShot.includes("KAKAO_ROUTE_QUOTA_BLOCKED"),
  'one-shot script must explicitly stop on quota denial');
assert.ok(routeRuntime.includes("if (quotaExceeded) break;") &&
  routeRuntime.includes("!quotaExceeded"),
  'runtime quota circuit breaker must prevent repeated pair/fallback calls');
assert.ok(api.includes("isKakaoRouteCooldownActive(Date.now())") &&
  api.includes("url.hostname === 'come-back-home.pages.dev'"),
  'Canonical Pages route handler must short-circuit during the temporary freeze');
assert.ok(api.includes("commitSha: BUILD_COMMIT_SHA") &&
  generator.includes('CF_PAGES_COMMIT_SHA'),
  'canonical version identifier build contract missing');
console.log(JSON.stringify({
  result:'PASS',
  defaultCiProviderTransport: 'MOCK_OR_FIXTURE',
  canonicalBrowser: 'ROUTE_FIXTURE_ONLY',
  liveRouteCallsInStandardCI: 0,
  oneShot: 'EXPLICIT_MANUAL_APPROVAL_ONLY',
  oneShotCallBudget: 1,
  beforeMidnightGate: true,
  postQuotaCircuitBreaker: true,
  versionStamp: true,
}));
