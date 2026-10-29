import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateTransitCacheSource, assessTransitCacheState, prepareTransitCacheDb, createScopedFiles, main, CONFIRMATION, BATCH, MIGRATION } from '../../scripts/private-work/prepare-transit-cache-db.mjs';
import { LEDGER_QUERY, SCHEMA_QUERY } from '../../scripts/private-work/prepare-login-db.mjs';
import { validateHouseholdSource, prepareHouseholdDb, MIGRATIONS as HOUSEHOLD_BATCH } from '../../scripts/private-work/prepare-household-db.mjs';

const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
const files = readdirSync('db/migrations').filter(name => name.endsWith('.sql')).sort();
const sources = Object.fromEntries(files.map(name => [name, readFileSync('db/migrations/' + name, 'utf8')]));
const source = validateTransitCacheSource(config, files, sources);
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)");
  for (const name of files.slice(0, 15)) {
    db.exec(sources[name]);
    db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(name);
  }
  db.exec("INSERT INTO people(id,name,created_at,updated_at) VALUES('synthetic-person','SYNTHETIC','2026-01-01','2026-01-01');INSERT INTO schedules(id,person_id,schedule_date,start_time,end_time,created_at,updated_at) VALUES('synthetic-shift','synthetic-person','2026-01-02','09:00','18:00','2026-01-01','2026-01-01');INSERT INTO auth_users VALUES('synthetic-member','yvonne','member',0,0,0,'2026-01-01');INSERT INTO case_profiles VALUES('synthetic-case','synthetic-member','2026-01-01');INSERT INTO case_consents VALUES('synthetic-case',0,'synthetic','synthetic',1,'synthetic-member','2026-01-01');");
  const events = [];
  const applyOne = () => {
    db.exec('BEGIN');
    try {
      db.exec(sources[MIGRATION]);
      db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(MIGRATION);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  return {
    db, events, source, applyOne,
    query: async sql => { events.push(sql); return db.prepare(sql).all(); },
    bookmark: async () => { events.push('bookmark'); return { bookmark: '00000001-00000002-00000003-0123456789abcdef' }; },
    recordRecovery: async () => { events.push('record'); },
    apply: async names => { events.push('apply'); assert.deepEqual(names, [MIGRATION]); applyOne(); },
  };
}
const snapshotRows = db => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'d1_migrations' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare('SELECT * FROM "' + name + '"').all()]);

test('only canonical DB and all sixteen immutable reviewed SQL files are accepted', () => {
  for (const bad of [{ ...config, name: 'other' }, { ...config, d1_databases: [] }, { ...config, d1_databases: [{ ...config.d1_databases[0], database_id: 'other' }] }, { ...config, d1_databases: [{ ...config.d1_databases[0], migrations_pattern: '**/*.sql' }] }])
    assert.throws(() => validateTransitCacheSource(bad, files, sources), /CANONICAL_DATABASE_MISMATCH/);
  for (const bad of [files.slice(0, 15), [...files, '0017_extra.sql'], [...files, 'unversioned.sql']])
    assert.throws(() => validateTransitCacheSource(config, bad, sources), /UNEXPECTED_REPOSITORY_MIGRATIONS/);
  for (const name of [files[0], files[14], MIGRATION])
    assert.throws(() => validateTransitCacheSource(config, files, { ...sources, [name]: sources[name] + '\n-- changed' }), /UNREVIEWED_MIGRATION/);
});

test('entry requires explicit dispatch batch, confirmation and exact reviewed commit', async () => {
  const sha = 'a'.repeat(40), allowed = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'ydh1121/ComeBackHome', GITHUB_SHA: sha, CBH_EXPECTED_SHA: sha, CBH_D1_BATCH: BATCH, CBH_D1_CONFIRMATION: CONFIRMATION };
  for (const change of [{ GITHUB_EVENT_NAME: 'push' }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_ACTIONS: 'false' }, { GITHUB_REPOSITORY: 'another/repository' }, { CBH_D1_BATCH: 'household-0013-0015' }, { CBH_D1_CONFIRMATION: 'APPLY_REMOTE_COMEBACKHOME_D1' }])
    await assert.rejects(main({ ...allowed, ...change }), /OWNER_DISPATCH_REQUIRED/);
  for (const change of [{ CBH_EXPECTED_SHA: '' }, { CBH_EXPECTED_SHA: 'b'.repeat(40) }, { GITHUB_SHA: 'b'.repeat(40) }])
    await assert.rejects(main({ ...allowed, ...change }), /REVIEWED_COMMIT_REQUIRED/);
  await assert.rejects(main(allowed), /EXISTING_CLOUDFLARE_ACTION_SECRETS_MISSING/);
});

test('temporary Wrangler runner exposes only0016 with no deployment or other bindings', () => {
  assert.throws(() => createScopedFiles(config, { ...sources, [MIGRATION]: sources[MIGRATION] + '\n-- changed' }), /UNREVIEWED_MIGRATION/);
  const scoped = createScopedFiles(config, sources);
  try {
    const runner = JSON.parse(readFileSync(scoped.path, 'utf8'));
    assert.deepEqual(Object.keys(runner).sort(), ['compatibility_date', 'd1_databases', 'name']);
    assert.equal(runner.name, 'come-back-home');
    assert.equal(runner.d1_databases.length, 1);
    assert.equal(runner.d1_databases[0].database_id, config.d1_databases[0].database_id);
    assert.deepEqual(readdirSync(join(scoped.directory, 'migrations')), [MIGRATION]);
    assert.equal(readFileSync(join(scoped.directory, 'migrations', MIGRATION), 'utf8'), sources[MIGRATION]);
  } finally { scoped.cleanup(); }
  assert.equal(existsSync(scoped.directory), false);
});

test('new empty cache is additive, every existing row survives, and reapplying writes nothing', async () => {
  const f = fixture(), before = snapshotRows(f.db);
  const result = await prepareTransitCacheDb(f);
  assert.deepEqual(result.applied, [MIGRATION]);
  assert.equal(result.preservedExistingSchema, true);
  for (const [name, rows] of before) assert.deepEqual(f.db.prepare('SELECT * FROM "' + name + '"').all(), rows);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notification_route_cache').get().n, 0);
  assert(f.events.indexOf('bookmark') < f.events.indexOf('record'));
  assert(f.events.indexOf('record') < f.events.indexOf('apply'));
  f.events.length = 0;
  assert.equal((await prepareTransitCacheDb(f)).schema, 'already-applied');
  assert(!f.events.includes('apply') && !f.events.includes('bookmark'));
  f.db.close();
});

for (const [name, change, error] of [
  ['old ledger', f => f.db.exec("DELETE FROM d1_migrations WHERE name LIKE '0015_%'"), /UNEXPECTED_REMOTE_MIGRATIONS/],
  ['unknown ledger', f => f.db.exec("UPDATE d1_migrations SET name='9999_unknown.sql' WHERE id=1"), /UNEXPECTED_REMOTE_MIGRATIONS/],
  ['unrecorded cache', f => f.db.exec(sources[MIGRATION]), /BASELINE_OR_PARTIAL_SCHEMA_MISMATCH/],
  ['altered baseline', f => f.db.exec('ALTER TABLE people ADD COLUMN unexpected TEXT'), /BASELINE_OR_PARTIAL_SCHEMA_MISMATCH/],
  ['missing old trigger', f => f.db.exec('DROP TRIGGER case_owner_immutable'), /BASELINE_OR_PARTIAL_SCHEMA_MISMATCH/],
  ['altered cache', f => { f.applyOne(); f.db.exec('ALTER TABLE notification_route_cache ADD COLUMN unexpected TEXT'); }, /TRANSIT_CACHE_SCHEMA_INCOMPLETE/],
]) test(name + ' stops before any remote write', async () => {
  const f = fixture(); change(f);
  await assert.rejects(prepareTransitCacheDb(f), error);
  assert(!f.events.includes('apply')); f.db.close();
});

test('missing recovery, failed recovery note and concurrent schema changes stop before apply', async () => {
  for (const bookmark of [{}, { bookmark: '' }, { bookmark: 'invalid' }]) {
    const f = fixture(); f.bookmark = async () => bookmark;
    await assert.rejects(prepareTransitCacheDb(f), /RECOVERY_POINT_UNAVAILABLE/);
    assert(!f.events.includes('apply')); f.db.close();
  }
  const f = fixture(); f.recordRecovery = async () => { throw Error('note unavailable'); };
  await assert.rejects(prepareTransitCacheDb(f), /note unavailable/);
  assert(!f.events.includes('apply')); f.db.close();
  const g = fixture(); g.recordRecovery = async () => g.db.exec('CREATE TABLE unexpected(id TEXT)');
  await assert.rejects(prepareTransitCacheDb(g), /SCHEMA_CHANGED_DURING_PREFLIGHT/);
  assert(!g.events.includes('apply')); g.db.close();
});

test('successful process exit without applying0016 is not success', async () => {
  const f = fixture(); f.apply = async () => {};
  await assert.rejects(prepareTransitCacheDb(f), /MIGRATION_NOT_APPLIED/); f.db.close();
});

test('failed apply does not retry, delete records or run a restore', async () => {
  const f = fixture(), before = snapshotRows(f.db); let attempts = 0;
  f.apply = async () => { attempts++; f.db.exec('BEGIN'); f.db.exec(sources[MIGRATION]); f.db.exec('ROLLBACK'); throw Error('synthetic failure'); };
  await assert.rejects(prepareTransitCacheDb(f), /synthetic failure/);
  assert.equal(attempts, 1); assert.deepEqual(snapshotRows(f.db), before);
  assert.equal(assessTransitCacheState(f.db.prepare(LEDGER_QUERY).all(), f.db.prepare(SCHEMA_QUERY).all(), source), 'pending');
  f.db.close();
});

test('earlier household runner recognizes reviewed0016 but never applies it', async () => {
  assert.equal(HOUSEHOLD_BATCH.length, 3);
  assert(!HOUSEHOLD_BATCH.includes(MIGRATION));
  const f = fixture(); f.applyOne();
  const householdSource = validateHouseholdSource(config, files, sources);
  const result = await prepareHouseholdDb({ ...f, source: householdSource, apply: async () => { throw Error('must not apply'); } });
  assert.equal(result.schema, 'already-applied');
  f.db.close();
});
