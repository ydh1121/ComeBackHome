import assert from 'node:assert/strict';

// Shared by isolated browser CI and the credential-free canonical smoke test.
// Never request a protected API: even a denied GET would append an audit row.
export async function verifyPublicAuthUi(page, origin) {
  const unexpected = [], writes = [], errors = [];
  const allowed = new Set(['/api/auth/session', '/api/auth/readiness', '/api/health']);
  const guard = async route => {
    const request = route.request(), url = new URL(request.url());
    if (!['GET', 'HEAD'].includes(request.method())) {
      writes.push(request.method()); return route.abort();
    }
    if (!allowed.has(url.pathname)) { unexpected.push('protected-api'); return route.abort(); }
    await route.continue();
  };
  const onError = error => errors.push(error.name);
  page.on('pageerror', onError);
  await page.route('**/api/**', guard);
  try {
    const response = await page.request.get(origin + '/api/auth/session');
    assert.equal(response.status(), 200, 'Public session status must be readable');
    const session = await response.json();
    assert.equal(session.enabled, true, 'Owner-activated authentication must stay enabled');
    assert.equal(session.user === null, true, 'Fresh browser must not authenticate itself');
    const paths = ['/', '/schedule', '/people', '/notifications', '/settings', '/settings/cache', '/import', '/injury?section=documents'];
    for (const path of paths) {
      await page.goto(origin + path, { waitUntil: 'networkidle' });
      await page.getByRole('button', {name:'로그인',exact:true}).waitFor();
      assert.equal(await page.getByLabel('아이디',{exact:true}).count(),1);
      assert.equal(await page.getByLabel('비밀번호',{exact:true}).getAttribute('type'),'password');
      assert.equal(await page.locator('[data-page], .private-page').count(),0,'Protected application must not mount before login');
      assert.equal(await page.locator('input[type=file]').count(),0,'No document selection before login');
      assert.equal(await page.locator('.auth-card input[type=password]').inputValue(),'');
    }
    for(const width of [375,390,768,1024,1440]) {
      await page.setViewportSize({width,height:900});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Login horizontal overflow');
      assert(await page.getByRole('button',{name:'로그인',exact:true}).isVisible());
    }
    assert.deepEqual(writes,[],'Never attempt a production mutation or login');
    assert.deepEqual(unexpected,[],'Never request private data or provider quota');
    assert.deepEqual(errors,[],'Login gate renders without JavaScript errors');
    assert.equal((await page.context().cookies()).some(c=>c.name==='__Host-cbh-session'),false,'No session is issued by public reads');
    return {protectedSurfaces:paths.length,responsiveWidths:[375,390,768,1024,1440],authGate:'PASS',appWrites:0,loginAttempts:0,protectedApiReads:0,providerCalls:0,privateDataExported:false,authenticatedProductUi:'ISOLATED_CI_ONLY'};
  } finally { await page.unroute('**/api/**', guard); page.off('pageerror',onError); }
}
