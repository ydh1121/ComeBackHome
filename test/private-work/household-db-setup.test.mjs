import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateHouseholdSource, assessHouseholdState, prepareHouseholdDb, createScopedFiles, main, CONFIRMATION, BATCH, MIGRATIONS } from '../../scripts/private-work/prepare-household-db.mjs';
import { LEDGER_QUERY, SCHEMA_QUERY } from '../../scripts/private-work/prepare-login-db.mjs';
const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
const files = readdirSync('db/migrations').filter(n => n.endsWith('.sql')).sort();
const sources = Object.fromEntries(files.map(n => [n, readFileSync('db/migrations/' + n, 'utf8')]));
const source = validateHouseholdSource(config, files, sources);
function fixture() {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)');
    for (const name of files.slice(0, 12)) {
        db.exec(sources[name]);
        db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(name);
    }
    db.exec("INSERT INTO people(id,name,created_at,updated_at) VALUES('synthetic-person','SYNTHETIC','2026-01-01','2026-01-01');INSERT INTO schedules(id,person_id,schedule_date,start_time,end_time,created_at,updated_at) VALUES('synthetic-shift','synthetic-person','2026-01-02','09:00','18:00','2026-01-01','2026-01-01');INSERT INTO auth_users VALUES('synthetic-member','yvonne','member',0,0,0,'2026-01-01');INSERT INTO case_profiles VALUES('synthetic-case','synthetic-member','2026-01-01');INSERT INTO case_consents VALUES('synthetic-case',0,'synthetic','synthetic',1,'synthetic-member','2026-01-01');");
    const events = [];
    const applyOne = name => { db.exec('BEGIN'); try {
        db.exec(sources[name]);
        db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(name);
        db.exec('COMMIT');
    }
    catch (e) {
        db.exec('ROLLBACK');
        throw e;
    } };
    return { db, events, source, applyOne, query: async (sql) => { events.push(sql); return db.prepare(sql).all(); }, bookmark: async () => { events.push('bookmark'); return { bookmark: '00000001-00000002-00000003-0123456789abcdef' }; }, recordRecovery: async () => { events.push('record'); }, apply: async (names) => { events.push('apply'); assert.deepEqual(names, MIGRATIONS); for (const name of names)
            applyOne(name); } };
}
function beforeRows(db) { return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'d1_migrations' ORDER BY name").all().map(({ name }) => [name, db.prepare('SELECT * FROM "' + name + '"').all()]); }
test('exact reviewed SQL and canonical DB required before remote access', () => {
    for (const bad of [{ ...config, name: 'other' }, { ...config, d1_databases: [] }, { ...config, d1_databases: [{ ...config.d1_databases[0], database_id: 'other' }] }, { ...config, d1_databases: [{ ...config.d1_databases[0], migrations_pattern: '**/*.sql' }] }])
        assert.throws(() => validateHouseholdSource(bad, files, sources), /CANONICAL_DATABASE_MISMATCH/);
    assert.throws(() => validateHouseholdSource(config, [...files, '0016_extra.sql'], sources), /UNEXPECTED_REPOSITORY_MIGRATIONS/);
    assert.throws(() => validateHouseholdSource(config, [...files, 'unversioned.sql'], sources), /UNEXPECTED_REPOSITORY_MIGRATIONS/);
    for (const name of [files[0], ...MIGRATIONS])
        assert.throws(() => validateHouseholdSource(config, files, { ...sources, [name]: sources[name] + '\n-- unreviewed' }), /UNREVIEWED_MIGRATION/);
});
test('remote entry requires dispatch, selected batch, explicit confirmation and exact approved commit', async () => {
    const sha = 'a'.repeat(40), allowed = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'ydh1121/ComeBackHome', GITHUB_SHA: sha, CBH_EXPECTED_SHA: sha, CBH_D1_BATCH: BATCH, CBH_D1_CONFIRMATION: CONFIRMATION };
    for (const change of [{ GITHUB_EVENT_NAME: 'push' }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_ACTIONS: 'false' }, { GITHUB_REPOSITORY: 'another/repository' }, { CBH_D1_BATCH: 'all' }, { CBH_D1_CONFIRMATION: 'APPLY_REMOTE_COMEBACKHOME_D1' }])
        await assert.rejects(main({ ...allowed, ...change }), /OWNER_DISPATCH_REQUIRED/);
    for (const change of [{ CBH_EXPECTED_SHA: '' }, { CBH_EXPECTED_SHA: 'b'.repeat(40) }, { GITHUB_SHA: 'b'.repeat(40) }])
        await assert.rejects(main({ ...allowed, ...change }), /REVIEWED_COMMIT_REQUIRED/);
    await assert.rejects(main(allowed), /EXISTING_CLOUDFLARE_ACTION_SECRETS_MISSING/);
});
test('scoped Wrangler config exposes only the three approved files and same existing DB', () => {
    assert.throws(() => createScopedFiles(config, { ...sources, [MIGRATIONS[0]]: sources[MIGRATIONS[0]] + '\n-- changed' }), /UNREVIEWED_MIGRATION/);
    const scoped = createScopedFiles(config, sources);
    try {
        const tmp = JSON.parse(readFileSync(scoped.path, 'utf8'));
        assert.equal(tmp.d1_databases[0].database_id, config.d1_databases[0].database_id);
        assert.equal(tmp.d1_databases.length, 1);
        assert.equal(tmp.d1_databases[0].migrations_dir, 'migrations');
        assert.equal(tmp.main, undefined);
        assert.equal(tmp.vars, undefined);
        assert.deepEqual(readdirSync(join(scoped.directory, 'migrations')).sort(), MIGRATIONS);
        for (const name of MIGRATIONS)
            assert.equal(readFileSync(join(scoped.directory, 'migrations', name), 'utf8'), sources[name]);
    }
    finally {
        scoped.cleanup();
    }
    assert.equal(existsSync(scoped.directory), false);
});
test('successful additive batch preserves all existing rows, waits for recovery and is idempotent', async () => {
    const f = fixture(), before = beforeRows(f.db), result = await prepareHouseholdDb(f);
    assert.deepEqual(result.applied, MIGRATIONS);
    assert.equal(result.preservedExistingSchema, true);
    for (const [name, data] of before)
        assert.deepEqual(f.db.prepare('SELECT * FROM "' + name + '"').all(), data);
    assert(f.events.indexOf('bookmark') < f.events.indexOf('record'));
    assert(f.events.indexOf('record') < f.events.indexOf('apply'));
    for (const name of ['household_workspace', 'household_card_uploads', 'case_chat_exchanges', 'household_notification_projection', 'household_push_bindings', 'household_notification_outbox'])
        assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ' + name).get().n, 0);
    f.events.length = 0;
    assert.equal((await prepareHouseholdDb(f)).schema, 'already-applied');
    assert(!f.events.includes('apply'));
    assert(!f.events.includes('bookmark'));
    f.db.close();
});
for (const [name, change, error] of [
    ['old schema', f => f.db.exec("DELETE FROM d1_migrations WHERE name LIKE '0012_%'"), /UNEXPECTED_REMOTE_MIGRATIONS/],
    ['unexpected migration history', f => f.db.exec("UPDATE d1_migrations SET name='9999_unknown.sql' WHERE id=1"), /UNEXPECTED_REMOTE_MIGRATIONS/],
    ['partial batch0013', f => f.applyOne(MIGRATIONS[0]), /PARTIAL_HOUSEHOLD_BATCH_STOP/],
    ['partial batch0014', f => { f.applyOne(MIGRATIONS[0]); f.applyOne(MIGRATIONS[1]); }, /PARTIAL_HOUSEHOLD_BATCH_STOP/],
    ['unrecorded new table', f => f.db.exec(sources[MIGRATIONS[0]]), /BASELINE_OR_PARTIAL_SCHEMA_MISMATCH/],
    ['unexpected baseline shape', f => f.db.exec('ALTER TABLE people ADD COLUMN unexpected TEXT'), /BASELINE_OR_PARTIAL_SCHEMA_MISMATCH/],
    ['missing existing trigger', f => f.db.exec('DROP TRIGGER case_owner_immutable'), /BASELINE_OR_PARTIAL_SCHEMA_MISMATCH/],
])
    test(name + ' stops before any write', async () => { const f = fixture(); change(f); await assert.rejects(prepareHouseholdDb(f), error); assert(!f.events.includes('apply')); f.db.close(); });
test('fully applied history with missing or altered definitions cannot pass', async () => {
    const f = fixture();
    await f.apply(MIGRATIONS);
    f.db.exec('DROP INDEX household_notification_due');
    assert.throws(() => assessHouseholdState(f.db.prepare(LEDGER_QUERY).all(), f.db.prepare(SCHEMA_QUERY).all(), source), /HOUSEHOLD_SCHEMA_INCOMPLETE/);
    f.db.close();
});
test('no recovery point, failed recovery note or concurrent schema change prevents writes', async () => {
    for (const bookmark of [{}, { bookmark: '' }, { bookmark: 'invalid' }]) {
        const f = fixture();
        f.bookmark = async () => bookmark;
        await assert.rejects(prepareHouseholdDb(f), /RECOVERY_POINT_UNAVAILABLE/);
        assert(!f.events.includes('apply'));
        f.db.close();
    }
    const f = fixture();
    f.recordRecovery = async () => { throw new Error('note unavailable'); };
    await assert.rejects(prepareHouseholdDb(f), /note unavailable/);
    assert(!f.events.includes('apply'));
    f.db.close();
    const g = fixture();
    g.recordRecovery = async () => g.db.exec('CREATE TABLE unrelated_change(id TEXT)');
    await assert.rejects(prepareHouseholdDb(g), /SCHEMA_CHANGED_DURING_PREFLIGHT/);
    assert(!g.events.includes('apply'));
    g.db.close();
});
test('successful process exit without all SQL applied cannot report success', async () => {
    const f = fixture();
    f.apply = async () => { };
    await assert.rejects(prepareHouseholdDb(f), /MIGRATION_NOT_APPLIED/);
    f.db.close();
});
test('migration failure has no automatic retry or destructive restore; partial result blocks the next run', async () => {
    const f = fixture(), before = beforeRows(f.db);
    let attempts = 0;
    f.apply = async () => { attempts++; f.applyOne(MIGRATIONS[0]); f.db.exec('BEGIN'); f.db.exec(sources[MIGRATIONS[1]]); f.db.exec('ROLLBACK'); throw new Error('synthetic second-file failure'); };
    await assert.rejects(prepareHouseholdDb(f), /synthetic second-file failure/);
    assert.equal(attempts, 1);
    for (const [name, data] of before)
        assert.deepEqual(f.db.prepare('SELECT * FROM "' + name + '"').all(), data);
    await assert.rejects(prepareHouseholdDb(f), /PARTIAL_HOUSEHOLD_BATCH_STOP/);
    assert.equal(attempts, 1);
    f.db.close();
});
