// Production rendering only. No screenshots, person values, writes or native actions.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, webkit } from 'playwright';

const origin = 'https://come-back-home.pages.dev';
let deployed = false;
for (let attempt = 0; attempt < 90; attempt++) {
  try {
    const response = await fetch(origin + '/api/health', { cache: 'no-store' });
    const health = await response.json();
    if (response.ok && health.ok === true && health.commitSha === process.env.GITHUB_SHA) { deployed = true; break; }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 10000));
}
assert.ok(deployed, 'Canonical Pages must serve this exact MAIN commit');
const results = [];
for (const [name, type] of [['Chromium', chromium], ['WebKit', webkit]]) {
  const browser = await type.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block' });
    const writes = [], errors = [], failedReads = [];
    let providerRequestsBlocked = 0;
    await context.route('**/api/**', async route => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) { writes.push(route.request().method()); return route.abort(); }
      // Today may ask for route/arrival enrichment. This deployment smoke
      // verifies UI and D1 reads without spending external transport quota.
      if (new URL(route.request().url()).pathname.startsWith('/api/providers/')) {
        providerRequestsBlocked++;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [], arrivals: [] }) });
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.name));
    page.on('response', response => {
      if (response.url().startsWith(origin + '/api/') && response.status() >= 500) failedReads.push(response.status());
    });
    const open = async path => {
      await page.goto(origin + path, { waitUntil: 'networkidle' });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile horizontal overflow');
    };
    await open('/');
    await page.locator('[data-page="TodayPage"][data-eta-status]').waitFor();
    assert.equal(await page.locator('.today-next-off').count(), 1);
    assert.equal(await page.getByText('나의 찾기', { exact: true }).count(), 1);
    assert.equal(await page.locator('.action-row .action-card').count(), 2);
    await open('/schedule');
    await page.locator('[data-page="SchedulePage"][data-state="VIEW_DAY"], [data-page="SchedulePage"][data-state="EMPTY"]').waitFor();
    assert.equal(await page.getByRole('button', { name: '일괄 입력', exact: true }).count(), 0);
    await page.getByRole('button', { name: '월별 이력', exact: false }).click();
    await page.locator('[data-page="ScheduleHistoryPage"][data-state="READY"]').waitFor();
    assert.ok(await page.locator('.schedule-cell').count() >= 28);
    assert.equal(await page.getByRole('button', { name: '일정 삭제', exact: true }).count(), 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 2), 'Monthly history vertical overflow');
    await open('/people');
    await page.locator('[data-page="PeoplePage"][data-state="LIST"], [data-page="PeoplePage"][data-state="EMPTY"]').waitFor();
    await open('/notifications');
    await page.locator('[data-page="NotificationSetupPage"] button.rule').first().waitFor();
    assert.equal(await page.locator('[data-page="NotificationSetupPage"] button.rule').count(), 2);
    assert.equal(await page.locator('.birthday-reminders button[aria-pressed]').count(), 4);
    await open('/settings');
    assert.equal(await page.getByRole('button', { name: '퇴근 · 귀가 기록 연결', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'iPhone 시계 알람', exact: true }).count(), 0);
    for (const [label, mode] of [['다크','dark'], ['화이트','light']]) {
      await open('/settings');
      await page.getByRole('radio', {name:label,exact:true}).check();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), mode);
      for (const path of ['/','/schedule','/import']) {
        await open(path);
        await page.locator('.page-reveal[aria-busy="false"]').waitFor();
        assert.equal(await page.locator('.page-skeleton').count(),0);
        assert.equal(await page.locator('.t-skel-content').evaluate(el => getComputedStyle(el).filter),'none');
      }
    }
    await page.setViewportSize({width:1440,height:960});
    await open('/schedule');
    const nav = await page.locator('.bottomnav').evaluate(el => { const r=el.getBoundingClientRect(); const s=document.querySelector('.app-shell').getBoundingClientRect(); return {center:r.x+r.width/2,shellCenter:s.x+s.width/2,bottom:r.bottom}; });
    assert.ok(Math.abs(nav.center-nav.shellCenter)<1 && Math.abs(nav.bottom-928)<1,'desktop floating navigation');
    await page.setViewportSize({width:390,height:844});
    await open('/settings');
    await page.getByRole('radio',{name:'시스템',exact:true}).check();
    await open('/settings/cache');
    await page.locator('[data-page="CacheSettingsPage"][data-state="READY"]').waitFor();
    assert.equal(await page.locator('button.rule[aria-pressed]').count(), 1);
    await open('/import');
    assert.equal(await page.locator('input[accept="image/*"][multiple]').count(), 1);
    assert.equal(await page.locator('input[accept=".xlsx"]').count(), 1);
    assert.deepEqual(writes, [], 'No application mutations may be attempted');
    assert.deepEqual(errors, [], 'No JavaScript errors');
    assert.deepEqual(failedReads, [], 'No failed production API reads');
    results.push({ browser: name, today: true, schedule: true, monthlyHistory: true, people: true, twoCommuteRules: true, fourBirthdayRules: true, localCacheSettings: true, multipleImageInput: true, xlsxInput: true, mobileFits: true, systemLightDark: true, noStaleSkeletonOrBlur: true, desktopNav: true, appWrites: 0, nativeActions: 0, testNotificationsSent: 0, providerRequestsBlocked, externalProviderAcceptance: 'NOT_TESTED', privateDataExported: false });
    await context.close();
  } finally { await browser.close(); }
}
mkdirSync('runtime-evidence/ui-deploy', { recursive: true });
const evidence = { commitSha: process.env.GITHUB_SHA, canonicalOrigin: origin, results };
writeFileSync('runtime-evidence/ui-deploy/readonly.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
