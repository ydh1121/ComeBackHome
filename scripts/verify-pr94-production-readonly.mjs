// Canonical anonymous rendering only. Authenticated product UI stays in isolated CI.
// No real credentials, screenshots, protected API reads, provider calls or mutations.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, webkit } from 'playwright';
import { verifyPublicAuthUi } from './private-work/verify-public-auth-ui.mjs';

const origin = 'https://come-back-home.pages.dev';
const expectedSha = process.env.CBH_EXPECTED_DEPLOY_SHA ?? process.env.GITHUB_SHA;
assert.match(expectedSha ?? '', /^[a-f0-9]{40}$/, 'Exact deployment commit is required');
let deployed = false;
for (let attempt = 0; attempt < 90; attempt++) {
  try {
    const response = await fetch(origin + '/api/health', { cache: 'no-store', redirect:'error', signal:AbortSignal.timeout(15000) });
    const health = await response.json();
    if (response.ok && health.ok === true && health.commitSha === expectedSha) { deployed = true; break; }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 10000));
}
assert.ok(deployed, 'Canonical Pages must serve this exact MAIN commit');
const results = [];
for (const [name, type] of [['Chromium', chromium], ['WebKit', webkit]]) {
  const browser = await type.launch({ headless: true });
  try {
    const context = await browser.newContext({viewport:{width:390,height:844},locale:'ko-KR',timezoneId:'Asia/Seoul',serviceWorkers:'block'});
    const page = await context.newPage();
    results.push({browser:name,...await verifyPublicAuthUi(page,origin)});
    await context.close();
  } finally { await browser.close(); }
}
mkdirSync('runtime-evidence/ui-deploy', { recursive: true });
const evidence = {commitSha:expectedSha,canonicalOrigin:origin,scope:'anonymous-auth-boundary',results};
writeFileSync('runtime-evidence/ui-deploy/readonly.json',JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence));
