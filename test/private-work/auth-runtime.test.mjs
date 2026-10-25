import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';
import { checkDeployedAuth } from '../../scripts/private-work/check-deployed-auth.mjs';

const vite = await createServer({ appType: 'custom', logLevel: 'error', server: { middlewareMode: true } });
after(() => vite.close());
const { hashPassword } = await vite.ssrLoadModule('/worker/modules/auth/crypto.ts');
const { createPasswordRuntimeCheck, authReadiness } = await vite.ssrLoadModule('/worker/modules/auth/readiness.ts');
const { handleProductRequest } = await vite.ssrLoadModule('/worker/modules/gateway.ts');
const { errorText } = await vite.ssrLoadModule('/src/modules/auth/client.ts');
const nativeDerive = crypto.subtle.deriveBits.bind(crypto.subtle);
const cap = () => new DOMException('Pbkdf2 failed: iteration counts above 100000 are not supported (requested 600000).', 'NotSupportedError');

async function withDerive(derive, run) {
  const original = Object.getOwnPropertyDescriptor(crypto.subtle, 'deriveBits');
  Object.defineProperty(crypto.subtle, 'deriveBits', { configurable: true, value: derive });
  try { return await run(); }
  finally {
    if (original) Object.defineProperty(crypto.subtle, 'deriveBits', original);
    else delete crypto.subtle.deriveBits;
  }
}

test('fixed runtime vector uses the unchanged 600k format and agrees with independent Node vector', async () => {
  const hash = await hashPassword('cbh-auth-runtime-probe-v1', new Uint8Array(16));
  assert.equal(hash.iterations, 600000);
  assert.equal(hash.hash_b64, '7Z0sARnt0CSGGpJd7T9sSXSt929/3JI7fI9OEOnTSms=');
});

test('concurrent public probes share one fixed derivation per isolate', async () => {
  let calls = 0;
  await withDerive(async (...args) => { calls++; assert.equal(args[0].iterations, 600000); return nativeDerive(...args); }, async () => {
    const check = createPasswordRuntimeCheck();
    assert.deepEqual(await Promise.all(Array.from({ length: 8 }, () => check())), Array(8).fill('supported'));
    assert.equal(await check(), 'supported');
    assert.equal(calls, 1);
  });
});

test('production-only iteration cap is classified without fallback or lower iterations', async () => {
  let calls = 0;
  await withDerive(async (algorithm) => { calls++; assert.equal(algorithm.iterations, 600000); throw cap(); }, async () => {
    await assert.rejects(hashPassword('synthetic-sensitive-value'), (error) => error.code === 'AUTH_PASSWORD_RUNTIME_UNSUPPORTED' && error.status === 503 && !error.message.includes('synthetic-sensitive'));
    assert.equal(calls, 1);
    const check = createPasswordRuntimeCheck();
    assert.equal(await check(), 'unsupported');
    assert.equal(await check(), 'unsupported');
    assert.equal(calls, 2);
  });
});

test('unknown crypto errors and wrong vector output are not misreported as supported or iteration caps', async () => {
  for (const failure of [new Error('private driver content'), new DOMException('different unsupported operation', 'NotSupportedError')]) {
    await withDerive(async () => { throw failure; }, async () => {
      await assert.rejects(hashPassword('synthetic-only'), (error) => error === failure);
      assert.equal(await createPasswordRuntimeCheck()(), 'unavailable');
    });
  }
  await withDerive(async () => new ArrayBuffer(32), async () => assert.equal(await createPasswordRuntimeCheck()(), 'unavailable'));
});

function policyDb(policy = { session_hours: 12, remembered_days: 30, idle_hours: 168 }) {
  return {
    prepare(source) {
      assert.equal(source, "SELECT session_hours,remembered_days,idle_hours FROM auth_policy WHERE id='default'", 'only policy read, no account/credentials/session/audit access');
      return { async first() { if (policy instanceof Error) throw policy; return policy; } };
    },
    batch() { assert.fail('readiness must not write'); },
  };
}

test('readiness is read-only, excludes all credentials and has no cookie/cache side effects', async () => {
  const response = await authReadiness(policyDb());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { database: 'ready', passwordRuntime: 'supported' });
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});

test('missing, invalid or failing policy reads remain unavailable without driver message disclosure', async () => {
  for (const policy of [null, { session_hours: 0 }, new Error('SELECT private_hash FROM auth_credentials')]) {
    const response = await authReadiness(policyDb(policy));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { database: 'unavailable', passwordRuntime: 'supported', error: 'AUTH_NOT_READY' });
  }
});

test('readiness identifies the cap with a ready database and reuses the failed probe', async () => {
  const isolated = await vite.ssrLoadModule('/worker/modules/auth/readiness.ts?synthetic-cap');
  let calls = 0;
  await withDerive(async () => { calls++; throw cap(); }, async () => {
    for (let i = 0; i < 2; i++) {
      const response = await isolated.authReadiness(policyDb());
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('Set-Cookie'), null);
      assert.deepEqual(await response.json(), { database: 'ready', passwordRuntime: 'unsupported', error: 'AUTH_PASSWORD_RUNTIME_UNSUPPORTED' });
    }
    assert.equal(calls, 1);
  });
});

test('readiness uses the existing flag and route, allows GET only and never grants access', async () => {
  const request = (method = 'GET') => new Request('https://local.invalid/api/auth/readiness', { method, headers: { Origin: 'https://local.invalid' } });
  const db = policyDb();
  assert.equal((await handleProductRequest(request(), { DB: db, PRIVATE_WORK_ENABLED: '0' })).status, 404);
  assert.equal((await handleProductRequest(request(), { DB: db, PRIVATE_WORK_ENABLED: '1' })).status, 200);
  const response = await handleProductRequest(request('POST'), { DB: db, PRIVATE_WORK_ENABLED: '1' });
  assert.equal(response.status, 401);
});

test('login exposes only the fixed unsupported-runtime code and cannot issue a session on crypto failure', async () => {
  const db = {
    prepare(source) {
      if (source.startsWith('INSERT INTO auth_rate_limits')) return { bind() { return this; }, async first() { return { attempts: 1 }; } };
      if (source === 'SELECT * FROM auth_users WHERE login_id=?1') return { bind() { return this; }, async first() { return null; } };
      assert.fail('crypto failure must not create a session or access other data: ' + source);
    },
  };
  const request = () => new Request('https://local.invalid/api/auth/login', {
    method: 'POST', headers: { Origin: 'https://local.invalid', 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginId: 'unknown-fixture', password: 'synthetic-sensitive-value' }),
  });
  for (const [failure, code] of [[cap(), 'AUTH_PASSWORD_RUNTIME_UNSUPPORTED'], [new Error('private driver secret'), 'PRIVATE_SERVICE_UNAVAILABLE']]) {
    await withDerive(async () => { throw failure; }, async () => {
      const response = await handleProductRequest(request(), { DB: db, PRIVATE_WORK_ENABLED: '1' });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('Set-Cookie'), null);
      assert.deepEqual(await response.json(), { error: code });
    });
  }
});

test('server failure copy does not blame the password or ask for duplicate setup', () => {
  for (const code of ['AUTH_PASSWORD_RUNTIME_UNSUPPORTED', 'AUTH_NOT_READY', 'PRIVATE_SERVICE_UNAVAILABLE']) {
    assert.match(errorText(code), /서버/);
    assert.doesNotMatch(errorText(code), /입력과 연결 상태/);
  }
  assert.equal(errorText('LOGIN_FAILED'), '아이디 또는 비밀번호를 확인해 주세요.');
});

test('deployed check pins the source, sends only two unauthenticated reads and reports failures honestly', async () => {
  const sha = 'a'.repeat(40);
  for (const state of ['supported', 'unsupported', 'disabled', 'malformed', 'stale']) {
    const calls = [];
    const fetcher = async (url, init) => {
      calls.push(url);
      assert.equal(init.method, 'GET');
      assert.equal(init.headers, undefined);
      assert.equal(init.body, undefined);
      assert.equal(init.redirect, 'error');
      if (url === 'https://come-back-home.pages.dev/api/health') return Response.json({ ok: true, commitSha: state === 'stale' ? 'b'.repeat(40) : sha });
      assert.equal(url, 'https://come-back-home.pages.dev/api/auth/readiness');
      if (state === 'disabled') return Response.json({ error: 'FEATURE_UNAVAILABLE' }, { status: 404 });
      if (state === 'malformed') return Response.json({ privateContent: 'must-not-be-logged' }, { status: 503 });
      return Response.json({ database: 'ready', passwordRuntime: state }, { status: state === 'supported' ? 200 : 503 });
    };
    if (state === 'stale') {
      await assert.rejects(checkDeployedAuth({ sha, fetcher }), /auth probe skipped/);
      assert.equal(calls.length, 1);
    } else {
      const result = await checkDeployedAuth({ sha, fetcher });
      assert.equal(result.auth, state === 'supported' ? 'runtime-ready' : state === 'disabled' ? 'disabled' : 'blocked');
      assert.equal(result.loginAccepted, false);
      assert.equal(result.writes, 0);
      assert.equal(calls.length, 2);
      assert.doesNotMatch(JSON.stringify(result), /must-not-be-logged/);
    }
  }
});
