import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { assessState, validateSource, rows, main, prepareLoginDb, MIGRATION, LEDGER_QUERY, SCHEMA_QUERY } from '../../scripts/private-work/prepare-login-db.mjs';

const files = readdirSync('db/migrations').filter((f) => f.endsWith('.sql')).sort();
const sql = readFileSync('db/migrations/' + MIGRATION, 'utf8');
const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
const objects = validateSource(config, files, sql);
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)');
  for (const f of files.slice(0, 11)) {
    db.exec(readFileSync('db/migrations/' + f, 'utf8'));
    db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(f);
  }
  db.exec("INSERT INTO people(id,name,created_at,updated_at) VALUES('test-person','SYNTHETIC','2026-01-01','2026-01-01'); INSERT INTO schedules(id,person_id,schedule_date,start_time,end_time,created_at,updated_at) VALUES('test-shift','test-person','2026-10-25','09:00','18:00','2026-01-01','2026-01-01')");
  const events = [];
  return { db, events, files, objects,
    query: async (q) => { events.push(q); return db.prepare(q).all(); },
    bookmark: async () => { events.push('bookmark'); return { bookmark: '00000001-00000002-00000003-0123456789abcdef' }; },
    recordRecovery: async () => { events.push('record'); },
    apply: async () => {
      events.push('apply'); db.exec('BEGIN');
      try { db.exec(sql); db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(MIGRATION); db.exec('COMMIT'); }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
function snapshotLegacy(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'d1_migrations' AND name NOT GLOB 'auth_*' AND name NOT GLOB 'case_*' ORDER BY name").all()
    .map(({ name }) => [name, db.prepare('SELECT * FROM "' + name + '"').all()]);
}
test('wrong project/database/source or a later migration stops before any remote call', () => {
  for (const wrong of [ { ...config, name: 'another-project' }, { ...config, d1_databases: [] }, { ...config, d1_databases: [{ ...config.d1_databases[0], database_id: 'another-db' }] }, { ...config, d1_databases: [{ ...config.d1_databases[0], migrations_pattern: 'other/*.sql' }] } ])
    assert.throws(() => validateSource(wrong, files, sql), /CANONICAL_DATABASE_MISMATCH/);
  assert.throws(() => validateSource(config, files, sql + '\nDROP TABLE people;'), /UNREVIEWED_MIGRATION/);
  assert.throws(() => validateSource(config, [...files, '0013_extra.sql'], sql), /UNEXPECTED_REPOSITORY_MIGRATIONS/);
  assert.throws(() => validateSource(config, [...files, 'unexpected.sql'], sql), /UNEXPECTED_REPOSITORY_MIGRATIONS/);
});
test('push/PR/local invocation cannot use the production runner', async () => {
  for (const event of [undefined, 'push', 'pull_request'])
    await assert.rejects(main({ GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: event }), /OWNER_DISPATCH_REQUIRED/);
});
test('failed/malformed D1 responses are not treated as an empty schema', () => {
  for (const p of [null, [], [{}], [{ success: false, results: [] }], [{ success: true, results: [] }, { success: true, results: [] }]])
    assert.throws(() => rows(p), /INVALID_D1_QUERY_RESULT/);
  assert.deepEqual(rows([{ success: true, results: [{ name: 'ok' }] }]), [{ name: 'ok' }]);
});
test('only 0012 is applied after recovery verification; every legacy row is preserved', async () => {
  const f = fixture(), before = snapshotLegacy(f.db);
  const result = await prepareLoginDb(f);
  assert.deepEqual(result.applied, [MIGRATION]);
  assert.equal(result.accountSetup, 'required-on-owner-pc');
  assert.deepEqual(snapshotLegacy(f.db), before);
  assert(f.events.indexOf('record') < f.events.indexOf('apply'));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM auth_users').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM case_profiles').get().n, 0);
  f.events.length = 0;
  assert.equal((await prepareLoginDb(f)).schema, 'already-applied');
  assert(!f.events.includes('apply'));
});
for (const [name, alter, error] of [
  ['older ledger', (db) => db.exec("DELETE FROM d1_migrations WHERE name LIKE '0011_%'"), /UNEXPECTED_REMOTE_MIGRATIONS/],
  ['unexpected ledger', (db) => db.exec("UPDATE d1_migrations SET name='9999_unknown.sql' WHERE id=1"), /UNEXPECTED_REMOTE_MIGRATIONS/],
  ['partial auth schema', (db) => db.exec('CREATE TABLE auth_users(id TEXT)'), /PARTIAL_PRIVATE_SCHEMA_STOP/],
  ['partial case schema', (db) => db.exec('CREATE TABLE case_records(id TEXT)'), /PARTIAL_PRIVATE_SCHEMA_STOP/],
  ['missing legacy table', (db) => db.exec('DROP TABLE presence_state'), /LEGACY_SCHEMA_INCOMPLETE/],
]) test(name + ' stops without writes', async () => {
  const f = fixture(); alter(f.db);
  await assert.rejects(prepareLoginDb(f), error);
  assert(!f.events.includes('apply'));
});
test('unavailable recovery or failure to save recovery timestamp stops without writes', async () => {
  for (const recovery of [{}, { bookmark: '' }, { bookmark: 'not-a-bookmark' }]) {
    const f = fixture(); f.bookmark = async () => recovery;
    await assert.rejects(prepareLoginDb(f), /RECOVERY_POINT_UNAVAILABLE/); assert(!f.events.includes('apply'));
  }
  const f = fixture(); f.recordRecovery = async () => { throw new Error('disk full'); };
  await assert.rejects(prepareLoginDb(f), /disk full/); assert(!f.events.includes('apply'));
});
test('schema changes between recovery lookup and apply stop without writes', async () => {
  const f = fixture(); f.recordRecovery = async () => f.db.exec('CREATE TABLE unexpected_change(id TEXT)');
  await assert.rejects(prepareLoginDb(f), /SCHEMA_CHANGED_DURING_PREFLIGHT/); assert(!f.events.includes('apply'));
});
test('failed apply has no automatic retry or restore, preserving the pre-migration schema', async () => {
  const f = fixture(), schema = f.db.prepare(SCHEMA_QUERY).all(), legacy = snapshotLegacy(f.db);
  let attempts = 0;
  f.apply = async () => { attempts++; f.db.exec('BEGIN'); f.db.exec(sql); f.db.exec('ROLLBACK'); throw new Error('synthetic migration failure'); };
  await assert.rejects(prepareLoginDb(f), /synthetic migration failure/);
  assert.equal(attempts, 1); assert.deepEqual(f.db.prepare(SCHEMA_QUERY).all(), schema); assert.deepEqual(snapshotLegacy(f.db), legacy);
});
test('success exit without applying SQL cannot produce a successful setup result', async () => {
  const f = fixture(); f.apply = async () => {};
  await assert.rejects(prepareLoginDb(f), /MIGRATION_NOT_APPLIED/);
});
test('a recorded migration with a missing required trigger is rejected', async () => {
  const f = fixture(); await f.apply(); f.db.exec('DROP TRIGGER case_owner_immutable');
  assert.throws(() => assessState(f.db.prepare(LEDGER_QUERY).all(), f.db.prepare(SCHEMA_QUERY).all(), files, objects), /PRIVATE_SCHEMA_INCOMPLETE/);
});
test('already-applied schema without the auth policy is not accepted and is not reinstalled', async () => {
  const f = fixture(); await f.apply(); f.events.length = 0; f.db.exec('DELETE FROM auth_policy');
  await assert.rejects(prepareLoginDb(f), /AUTH_POLICY_MISSING/); assert(!f.events.includes('apply'));
});
test('unexpected legacy schema changes or missing policy are not accepted after apply', async () => {
  for (const [change, error] of [['ALTER TABLE people ADD COLUMN unexpected TEXT', /LEGACY_SCHEMA_CHANGED/], ['DELETE FROM auth_policy', /INITIAL_AUTH_POLICY_MISSING/]]) {
    const f = fixture(), apply = f.apply; f.apply = async () => { await apply(); f.db.exec(change); };
    await assert.rejects(prepareLoginDb(f), error);
  }
});

const grantSql = readFileSync('scripts/private-work/complete-login-access.sql', 'utf8');
const readinessSql = readFileSync('scripts/private-work/check-login-setup.sql', 'utf8');
function seedAccount(db, login, credential = true) {
  db.prepare('INSERT INTO auth_users VALUES(?,?,?,0,1,0,?)').run(login, login, login === 'yvonne' ? 'member' : 'admin', '2026-10-25');
  if (credential) db.prepare('INSERT INTO auth_credentials VALUES(?,?,600000,?,?,?)').run(login, 'pbkdf2-sha256', 'SYNTHETIC_SALT', 'SYNTHETIC_HASH', '2026-10-25');
  db.prepare('INSERT INTO auth_preferences VALUES(?,1,?)').run(login, '2026-10-25');
}
function seedCase(db) { db.exec("INSERT INTO case_profiles VALUES('test-case','yvonne','2026-10-25'); INSERT INTO case_consents VALUES('test-case',0,'','',1,'yvonne','2026-10-25')"); }
test('comment-free console statements and one-line status distinguish empty, partial and ready accounts', async () => {
  const f = fixture(); await f.apply();
  assert.equal(readinessSql.trim().split(/\r?\n/).length, 1);
  const status = () => Object.values(f.db.prepare(readinessSql).get());
  assert.deepEqual(status(), [0, 0, 0, 0]);
  seedAccount(f.db, 'ydh1121'); assert.deepEqual(status(), [1, 1, 0, 0]);
  seedAccount(f.db, 'yvonne'); assert.deepEqual(status(), [2, 2, 0, 0]);
  seedCase(f.db); assert.deepEqual(status(), [2, 2, 0, 1]);
  const lines = grantSql.trim().split(/\r?\n/);
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.match(line, /^(INSERT|WITH) /);
    assert(!line.includes('--'));
    f.db.exec(line); // Also valid in a console that executes one input line at a time.
  }
  assert.deepEqual(status(), [2, 2, 2, 1]);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM auth_audit').get().n, 2);
});
test('both accounts without a case owner/consent cannot receive setup grants', async () => {
  const f = fixture(); await f.apply(); seedAccount(f.db, 'ydh1121'); seedAccount(f.db, 'yvonne');
  f.db.exec(grantSql); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM auth_workspace_grants').get().n, 0);
  f.db.exec("INSERT INTO case_profiles VALUES('test-case','yvonne','2026-10-25')");
  f.db.exec(grantSql); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM auth_workspace_grants').get().n, 0);
});
test('shared schedule setup requires both credentials and the original owner/consent', async () => {
  const f = fixture(); await f.apply();
  f.db.exec(grantSql); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM auth_workspace_grants').get().n, 0);
  seedAccount(f.db, 'ydh1121'); seedAccount(f.db, 'yvonne', false); seedCase(f.db);
  f.db.exec(grantSql); assert.equal(f.db.prepare('SELECT COUNT(*) n FROM auth_workspace_grants').get().n, 0);
  f.db.exec("INSERT INTO auth_credentials VALUES('yvonne','pbkdf2-sha256',600000,'SYNTHETIC_SALT','SYNTHETIC_HASH','2026-10-25')");
  const credentials = f.db.prepare('SELECT * FROM auth_credentials').all(), legacy = snapshotLegacy(f.db);
  f.db.exec(grantSql); f.db.exec(grantSql);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM auth_workspace_grants WHERE permission='write'").get().n, 2);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM auth_audit').get().n, 2);
  assert.deepEqual(f.db.prepare('SELECT * FROM auth_credentials').all(), credentials);
  assert.deepEqual(snapshotLegacy(f.db), legacy);
  assert.equal(f.db.prepare('SELECT admin_access FROM case_consents').get().admin_access, 0);
  const status = f.db.prepare(grantSql.slice(grantSql.indexOf('WITH expected'))).all();
  assert.deepEqual(status.map((r) => r.result), ['READY_FOR_LOGIN', 'READY_FOR_LOGIN']);
  assert.deepEqual(Object.keys(status[0]), ['account', 'password_record', 'shared_workspace_access', 'result']);
});
