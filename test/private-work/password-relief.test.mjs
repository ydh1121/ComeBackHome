import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'error', server: { middlewareMode: true } });
after(() => vite.close());
const { handleProductRequest } = await vite.ssrLoadModule('/worker/modules/gateway.ts');
const { passwordRecord, passwordVerifier, wrapLegacyPassword, verifyPasswordMaterial } = await vite.ssrLoadModule('/worker/modules/auth/password-verifier.ts');
const { derivePasswordMaterial, loginWithPassword, changeWithPassword } = await vite.ssrLoadModule('/src/modules/auth/password.ts');
const { onRequest } = await vite.ssrLoadModule('/functions/api/_middleware.ts');
const protocol = 'cbh-pbkdf2-relief/v1', password = 'Synthetic-relief-only!123', nextPassword = 'Synthetic-new-relief!456';
const origin = 'https://local.invalid', salt = Buffer.alloc(16, 3).toString('base64');
const derive = (value, salt) => pbkdf2Sync(value, Buffer.from(salt, 'base64'), 600000, 32, 'sha256').toString('base64');
const legacy = { algorithm: 'pbkdf2-sha256', iterations: 600000, salt_b64: salt, hash_b64: derive(password, salt) };
const nativeDerive = crypto.subtle.deriveBits.bind(crypto.subtle);
async function capped(run) {
  const original = Object.getOwnPropertyDescriptor(crypto.subtle, 'deriveBits'), calls = [];
  Object.defineProperty(crypto.subtle, 'deriveBits', { configurable: true, value: async (a, ...rest) => {
    calls.push(a.iterations);
    if (a.iterations > 100000) throw new DOMException(`Pbkdf2 failed: iteration counts above 100000 are not supported (requested ${a.iterations}).`, 'NotSupportedError');
    return nativeDerive(a, ...rest);
  } });
  try { await run(); assert(calls.length > 0); assert(calls.every(n => n === 10000)); }
  finally { if (original) Object.defineProperty(crypto.subtle, 'deriveBits', original); else delete crypto.subtle.deriveBits; }
}
function fixture(t) {
  const sql = new DatabaseSync(':memory:'); t.after(() => sql.close());
  sql.exec(readFileSync('db/migrations/0012_private_work_modules.sql', 'utf8'));
  const instant = new Date().toISOString();
  sql.prepare('INSERT INTO auth_users VALUES(?,?,?,0,1,0,?)').run('synthetic-id','yvonne','member',instant);
  sql.prepare('INSERT INTO auth_credentials VALUES(?,?,?,?,?,?)').run('synthetic-id',legacy.algorithm,legacy.iterations,salt,legacy.hash_b64,instant);
  sql.prepare('INSERT INTO auth_workspace_grants VALUES(?,?,?,?)').run('synthetic-id','legacy','write',instant);
  let hook = null;
  const db = {
    prepare(source) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async run() {
          hook?.(source);
          const bound = [], text = source.replace(/\?(\d+)/g, (_, n) => { bound.push(values[Number(n)-1]); return '?'; });
          const stmt = sql.prepare(text);
          return { success: true, results: stmt.columns().length ? stmt.all(...bound) : (stmt.run(...bound), []) };
        },
        async all() { return this.run(); },
        async first() { return (await this.run()).results[0] ?? null; },
      };
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try { const result = []; for (const stmt of statements) result.push(await stmt.run()); sql.exec('COMMIT'); return result; }
      catch (e) { sql.exec('ROLLBACK'); throw e; }
    },
  };
  const env = { DB: db, PRIVATE_WORK_ENABLED: '1' };
  const call = (path, body, cookie, caller = origin) => handleProductRequest(new Request(origin+'/api/auth/'+path, {
    method: body === undefined ? 'GET' : 'POST', headers: { Origin: caller, 'Content-Type':'application/json', ...(cookie ? {Cookie:cookie} : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const stored = () => sql.prepare('SELECT algorithm,iterations,salt_b64,hash_b64 FROM auth_credentials').get();
  const prepare = () => call('login-parameters', { loginId: 'yvonne' });
  const login = (material = legacy.hash_b64, clientSalt = salt) => call('login', { protocol, loginId:'yvonne', material, salt:clientSalt, remember:true });
  return { sql, db, env, call, stored, prepare, login, setHook(fn) { hook = fn; } };
}

test('browser 600k agrees with independent Node and rejects downgraded/malformed parameters', async () => {
  assert.equal(await derivePasswordMaterial(password, { protocol, iterations:600000, salt }), legacy.hash_b64);
  for (const params of [{protocol,iterations:10000,salt}, {protocol:'older',iterations:600000,salt}, {protocol,iterations:600000,salt:'invalid'}])
    await assert.rejects(derivePasswordMaterial(password, params), e => e.code === 'CLIENT_UPDATE_REQUIRED');
});
test('salted server verifier preserves legacy material but is not itself a login credential', async () => {
  await capped(async () => {
    const wrapped = await wrapLegacyPassword(legacy);
    assert.equal(passwordRecord(wrapped).version, 2);
    assert.equal(wrapped.iterations, 600000); assert.equal(wrapped.salt_b64, salt);
    assert.notEqual(wrapped.hash_b64, legacy.hash_b64);
    assert.equal(await verifyPasswordMaterial(legacy.hash_b64, wrapped), true);
    assert.equal(await verifyPasswordMaterial(wrapped.hash_b64, wrapped), false);
    assert.equal(await verifyPasswordMaterial(derive('wrong synthetic', salt), wrapped), false);
    assert.deepEqual(await wrapLegacyPassword(wrapped), wrapped);
    await assert.rejects(verifyPasswordMaterial(legacy.hash_b64, legacy), e => e.code === 'AUTH_PASSWORD_UPGRADE_REQUIRED');
  });
});
test('strict format fails closed; no silent weaker work factor or raw hash fallback', () => {
  for (const change of [{iterations:10000},{algorithm:'sha256'},{salt_b64:'abc'},{hash_b64:'abc'},{hash_b64:Buffer.alloc(56).toString('base64')}])
    assert.throws(() => passwordRecord({...legacy,...change}), e => e.code === 'AUTH_PASSWORD_RECORD_INVALID');
});
test('preparation atomically upgrades once without sessions, access changes or forced-change bypass', async t => {
  const f = fixture(t), before = f.sql.prepare('SELECT * FROM auth_users').get(), grants = f.sql.prepare('SELECT * FROM auth_workspace_grants').all();
  await capped(async () => {
    const first = await f.prepare(); assert.equal(first.status,200);
    assert.equal(first.headers.get('Set-Cookie'),null); assert.equal(first.headers.get('Cache-Control'),'private, no-store');
    assert.deepEqual(await first.json(), {protocol,iterations:600000,salt});
    const wrapped = f.stored(); assert.equal(passwordRecord(wrapped).version,2);
    assert.equal((await f.prepare()).status,200); assert.deepEqual(f.stored(), wrapped);
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM auth_audit WHERE action='credential-format-upgrade'").get().n,1);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n,0);
    assert.deepEqual(f.sql.prepare('SELECT * FROM auth_users').get(),before);
    assert.deepEqual(f.sql.prepare('SELECT * FROM auth_workspace_grants').all(),grants);
  });
});
test('failed audit rolls back credential upgrade, retry keeps existing password usable', async t => {
  const f = fixture(t);
  f.setHook(source => { if(source.startsWith('INSERT INTO auth_audit SELECT')) throw Error('synthetic failure'); });
  assert.equal((await f.prepare()).status,503); assert.equal(f.stored().hash_b64,legacy.hash_b64);
  f.setHook(null); assert.equal((await f.prepare()).status,200); assert.equal((await f.login()).status,200);
});
test('concurrent upgrade loses CAS safely and never replaces a changed credential', async t => {
  const f = fixture(t), newSalt = randomBytes(16).toString('base64');
  const concurrent = await passwordVerifier(Buffer.from(derive(nextPassword,newSalt),'base64'),Buffer.from(newSalt,'base64'));
  f.setHook(source => { if(!source.startsWith('UPDATE auth_credentials SET hash_b64')) return; f.setHook(null);
    f.sql.prepare('UPDATE auth_credentials SET salt_b64=?,hash_b64=?').run(newSalt,concurrent.hash_b64);
    f.sql.exec('UPDATE auth_users SET auth_epoch=auth_epoch+1');
  });
  assert.equal((await f.prepare()).status,200); assert.equal(f.stored().hash_b64,concurrent.hash_b64);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM auth_audit WHERE action='credential-format-upgrade'").get().n,0);
  assert.equal((await f.login()).status,401);
  assert.equal((await f.login(derive(nextPassword,newSalt),newSalt)).status,200);
});
test('old plaintext clients, unprepared legacy records and wrong materials cannot create sessions', async t => {
  const f = fixture(t);
  assert.equal((await f.call('login',{loginId:'yvonne',password})).status,426);
  assert.equal((await f.login()).status,503);
  await f.prepare();
  for(const material of [undefined,'invalid',f.stored().hash_b64,derive('wrong synthetic',salt)]) {
    const r=await f.login(material === undefined ? '' : material); assert.equal(r.status,401); assert.equal(r.headers.get('Set-Cookie'),null);
  }
  assert.equal((await f.login(legacy.hash_b64,Buffer.alloc(16).toString('base64'))).status,401);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n,0);
});
test('disabled and unknown users cannot upgrade, log in or read password parameters', async t => {
  const f = fixture(t); f.sql.exec('UPDATE auth_users SET disabled=1');
  for (const loginId of ['yvonne','unknown']) {
    assert.equal((await f.call('login-parameters',{loginId})).status,200);
    const r = await f.call('login',{protocol,loginId,salt,material:legacy.hash_b64});
    assert.notEqual(r.status,200); assert.equal(r.headers.get('Set-Cookie'),null);
  }
  assert.equal(f.stored().hash_b64,legacy.hash_b64);
  assert.equal((await f.call('password-parameters')).status,401);
});
test('cross-site preparation and login fail before any credential mutation', async t => {
  const f = fixture(t);
  for(const path of ['login-parameters','login']) assert.equal((await f.call(path,{loginId:'yvonne',protocol,salt,material:legacy.hash_b64},null,'https://attacker.invalid')).status,403);
  assert.equal(f.stored().hash_b64,legacy.hash_b64);
});
test('preparation is rate limited independently of final verification', async t => {
  const f=fixture(t);
  for(let i=0;i<10;i++) assert.equal((await f.prepare()).status,200);
  assert.equal((await f.prepare()).status,429); assert.equal((await f.login()).status,200);
});
test('capped server completes login, mandatory change, relogin and revokes every previous session', async t => {
  const f=fixture(t);
  await capped(async()=>{
    await f.prepare(); const a=await f.login(), b=await f.login(); assert.equal(a.status,200); assert.equal(b.status,200);
    const cookie=a.headers.get('Set-Cookie').split(';')[0], cookie2=b.headers.get('Set-Cookie').split(';')[0];
    assert.equal((await a.json()).user.mustChangePassword,true);
    const params=await (await f.call('password-parameters',undefined,cookie)).json();
    const newSalt=randomBytes(16).toString('base64');
    const body={protocol,salt:params.salt,currentMaterial:legacy.hash_b64,newMaterial:derive(nextPassword,newSalt),newSalt};
    assert.equal((await f.call('password',{...body,currentMaterial:derive('wrong',salt)},cookie)).status,401);
    assert.equal((await f.call('password',{...body,newSalt:salt},cookie)).status,400);
    assert.equal((await f.call('password',body,cookie)).status,200);
    for(const token of [cookie,cookie2]) assert.equal((await (await f.call('session',undefined,token)).json()).user,null);
    assert.equal((await f.login()).status,401);
    const fresh=await f.login(body.newMaterial,newSalt); assert.equal(fresh.status,200); assert.equal((await fresh.json()).user.mustChangePassword,false);
    assert.equal(f.sql.prepare('SELECT auth_epoch FROM auth_users').get().auth_epoch,1);
  });
});
test('password change rejects a concurrent epoch change without overwriting credentials', async t=>{
  const f=fixture(t); await f.prepare(); const before=f.stored(), response=await f.login();
  const cookie=response.headers.get('Set-Cookie').split(';')[0], newSalt=randomBytes(16).toString('base64');
  f.setHook(source=>{ if(!source.startsWith('UPDATE auth_credentials SET algorithm')) return; f.setHook(null); f.sql.exec('UPDATE auth_users SET auth_epoch=auth_epoch+1'); });
  assert.equal((await f.call('password',{protocol,salt,currentMaterial:legacy.hash_b64,newMaterial:derive(nextPassword,newSalt),newSalt},cookie)).status,409);
  assert.deepEqual(f.stored(),before);
});
test('browser request bodies carry only derived materials; client rejects invalid new passwords before network', async()=>{
  const original=globalThis.fetch, calls=[];
  globalThis.fetch=async(url,init)=>{
    const body=init.body ? JSON.parse(init.body):undefined; calls.push({url,body});
    assert(!init.body?.includes(password)); assert(!init.body?.includes(nextPassword));
    return Response.json(url.endsWith('parameters')?{protocol,iterations:600000,salt}:{ok:true});
  };
  try {
    await loginWithPassword({loginId:'yvonne',password,remember:true,deviceName:'synthetic'});
    assert.equal(calls[1].body.material,legacy.hash_b64); assert.equal(calls[1].body.password,undefined);
    await changeWithPassword(password,nextPassword);
    assert.equal(calls[3].body.currentMaterial,legacy.hash_b64); assert.equal(calls[3].body.newMaterial,derive(nextPassword,calls[3].body.newSalt));
    const count=calls.length;
    for(const invalid of ['short','x'.repeat(15),password,'x'.repeat(129)]) await assert.rejects(changeWithPassword(password,invalid),e=>e.code==='PASSWORD_INVALID');
    assert.equal(calls.length,count);
  } finally { globalThis.fetch=original; }
});
test('canonical adapter defaults to protected mode without touching owner env; explicit off is preserved', async t=>{
  const f=fixture(t), env={DB:f.db};
  const request=()=>new Request(origin+'/api/auth/session');
  assert.deepEqual(await (await onRequest({request:request(),env})).json(),{enabled:true,user:null});
  assert.equal(env.PRIVATE_WORK_ENABLED,undefined);
  assert.deepEqual(await (await onRequest({request:request(),env:{...env,PRIVATE_WORK_ENABLED:'0'}})).json(),{enabled:false,user:null});
});
