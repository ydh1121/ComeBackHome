// Owner-authorized PR #92 release, 2026-10-17. No app writes or push tests.
// Plaintext exports stay on the ephemeral runner; only authenticated ciphertext
// and aggregate/schema evidence may be uploaded as Actions artifacts.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, createCipheriv, publicEncrypt, constants } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const phase = process.argv[2];
if (!['preflight', 'migrate', 'verify'].includes(phase)) throw new Error('Unknown release phase');
if (process.env.GITHUB_REPOSITORY !== 'ydh1121/ComeBackHome') throw new Error('Repository mismatch');
const cfg = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
const db = cfg.d1_databases.find(item => item.binding === 'DB');
if (db?.database_name !== 'come-back-home-db' || db.database_id !== '5b5d6397-042c-465b-8411-9e67555eaeb4') throw new Error('Database mismatch');
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) throw new Error('Existing Cloudflare credentials missing');
const base = 'https://api.cloudflare.com/client/v4/accounts/' + account;
const sha = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const output = 'runtime-evidence/pr92-release';
mkdirSync(output, { recursive: true });
async function cf(path, body) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok || value.success !== true) throw new Error('Cloudflare request failed: HTTP ' + response.status + ' (' + path.replace(db.database_id, 'DB') + ')');
  return value.result;
}
async function query(sql) {
  const result = await cf('/d1/database/' + db.database_id + '/query', { sql });
  if (!Array.isArray(result) || result.some(item => item.success === false)) throw new Error('D1 query failed');
  return result.flatMap(item => item.results ?? []);
}
function wrangler(args) {
  try { return execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', ...args, '--config', 'wrangler.jsonc'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CI: '1' } }); }
  catch { throw new Error('Wrangler D1 ' + args[0] + ' failed; private command output withheld'); }
}
const migrations = ['0009_approved_workbook_import_receipts.sql', '0010_arrival_advance_notification.sql'];
const protectedTables = ['people', 'schedules', 'places', 'push_subscriptions', 'notification_settings', 'saved_commute_routes', 'saved_commute_route_vias', 'saved_commute_route_origins', 'saved_commute_route_destinations'];
async function coreSnapshot(projections) {
  const tables = [];
  for (const table of protectedTables) {
    const columns = projections?.[table] ?? (await query('PRAGMA table_info("' + table + '")')).map(row => row.name).filter(name => name !== 'arrival_advance_enabled');
    if (!columns.length || columns.some(name => !/^[a-zA-Z0-9_]+$/.test(name))) throw new Error('Unexpected protected table schema');
    const rows = await query('SELECT ' + columns.map(name => '"' + name + '"').join(',') + ' FROM "' + table + '"');
    const normalized = rows.map(row => JSON.stringify(columns.map(name => row[name]))).sort();
    tables.push({ table, columns, count: rows.length, sha256: sha(normalized) });
  }
  return { tables, sha256: sha(tables) };
}
const project = await cf('/pages/projects/come-back-home');
const prod = project.deployment_configs?.production;
if (prod?.d1_databases?.DB?.id !== db.database_id) throw new Error('Canonical Pages DB binding mismatch');
if (project.source?.config?.production_branch !== 'main') throw new Error('Canonical production branch mismatch');
const before = await coreSnapshot();
const ledger = (await query('SELECT name FROM d1_migrations ORDER BY name')).map(row => row.name);
const pending = migrations.filter(name => !ledger.includes(name));
const report = {
  phase, sourceSha: process.env.GITHUB_SHA, checkedAt: new Date().toISOString(),
  canonicalOrigin: 'https://come-back-home.pages.dev',
  deployedCommit: project.canonical_deployment?.deployment_trigger?.metadata?.commit_hash ?? project.latest_deployment?.deployment_trigger?.metadata?.commit_hash ?? null,
  productionDeploymentsEnabled: project.source?.config?.production_deployments_enabled,
  priorMigrations: ledger, pendingMigrations: pending, core: before,
  duplicateNameGroups: (await query("SELECT COUNT(*) AS count FROM (SELECT lower(replace(trim(name),' ','')) AS normalized FROM people GROUP BY normalized HAVING COUNT(*) > 1)"))[0]?.count,
  pushConfigured: ['VAPID_PRIVATE_KEY','VAPID_PUBLIC_KEY'].every(key => Boolean(prod.env_vars?.[key])),
  migrationsSha256: Object.fromEntries(migrations.map(name => [name, sha(readFileSync('db/migrations/' + name))])),
  appWrites: 0, testNotificationsSent: 0, privateValuesPublished: false,
};
if (ledger.filter(name => /^000[1-8]_/.test(name)).length !== 8) throw new Error('Unexpected migration baseline');
if (phase === 'preflight') {
  const sqlPath = join(tmpdir(), 'cbh-pr92-backup-' + process.pid + '.sql');
  const sqlitePath = sqlPath + '.sqlite';
  try {
    report.timeTravel = JSON.parse(wrangler(['time-travel', 'info', db.database_name, '--json']));
    wrangler(['export', db.database_name, '--remote', '--output', sqlPath]);
    const bytes = readFileSync(sqlPath);
    const key = randomBytes(32), iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
    const publicKey = readFileSync('runtime-evidence/pr92-release-backup-public.pem');
    const envelope = {
      schema: 'cbh-encrypted-backup/v1', cipher: 'AES-256-GCM', keyWrap: 'RSA-OAEP-SHA256',
      encryptedKey: publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key).toString('base64'),
      iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64'),
      plaintextSha256: sha(bytes), publicKeySha256: sha(publicKey),
    };
    const encrypted = JSON.stringify(envelope) + '\n';
    writeFileSync(output + '/production-d1.encrypted.json', encrypted);
    report.backup = { encryptedSha256: sha(encrypted), plaintextSha256: sha(bytes), plaintextBytes: bytes.length, publicKeySha256: sha(publicKey) };
    const rehearsal = execFileSync('python3', ['-c', `import sqlite3,json,sys,pathlib
db=sqlite3.connect(sys.argv[2])
db.executescript(pathlib.Path(sys.argv[1]).read_text())
tables=json.loads(sys.argv[3])
columns={t:[r[1] for r in db.execute('PRAGMA table_info("'+t+'")')] for t in tables}
def snapshot():
 return {t:sorted([json.dumps(list(r),ensure_ascii=False,default=str) for r in db.execute('SELECT '+','.join('"'+c+'"' for c in columns[t])+' FROM "'+t+'"')]) for t in tables}
before=snapshot()
for name in json.loads(sys.argv[4]): db.executescript(pathlib.Path('db/migrations',name).read_text())
assert before==snapshot(),'Protected data changed during rehearsal'
assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
assert not list(db.execute('PRAGMA foreign_key_check'))
print(json.dumps({'schemaMigrationRehearsal':'PASS','protectedDataPreserved':True,'integrity':'ok'}))`, sqlPath, sqlitePath, JSON.stringify(protectedTables), JSON.stringify(pending)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    report.rehearsal = JSON.parse(rehearsal);
    const after = await coreSnapshot(Object.fromEntries(before.tables.map(t => [t.table, t.columns])));
    if (before.sha256 !== after.sha256) throw new Error('Core data changed during backup; take a fresh backup before migration');
  } finally { rmSync(sqlPath, { force: true }); rmSync(sqlitePath, { force: true }); }
} else if (phase === 'migrate') {
  if (!process.env.BACKUP_DRIVE_ID || process.env.EXPECTED_CORE_SHA !== before.sha256) throw new Error('Verified durable backup or matching core fingerprint missing');
  report.backupDriveId = process.env.BACKUP_DRIVE_ID;
  report.timeTravelBeforeMigration = JSON.parse(wrangler(['time-travel', 'info', db.database_name, '--json']));
  if (pending.length) wrangler(['migrations', 'apply', db.database_name, '--remote']);
  const after = await coreSnapshot(Object.fromEntries(before.tables.map(t => [t.table, t.columns])));
  if (before.sha256 !== after.sha256) throw new Error('Core-data readback changed; stop release and investigate without automatic restore');
  report.afterMigrations = (await query('SELECT name FROM d1_migrations ORDER BY name')).map(row => row.name);
  if (!migrations.every(name => report.afterMigrations.includes(name))) throw new Error('Migration ledger incomplete');
  report.coreDataPreserved = true;
  report.tablesVerified = (await query("SELECT name FROM sqlite_master WHERE name IN ('approved_workbook_import_receipts','approved_workbook_import_checks','notification_arrival_plan') ORDER BY name")).map(row => row.name);
  if (report.tablesVerified.length !== 3) throw new Error('New tables missing');
}
writeFileSync(output + '/' + phase + '.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ phase, result: 'PASS', sourceSha: report.sourceSha, pendingMigrations: pending, coreDataPreserved: report.coreDataPreserved ?? report.rehearsal?.protectedDataPreserved, encryptedBackupReady: Boolean(report.backup), privateValuesPublished: false }));
