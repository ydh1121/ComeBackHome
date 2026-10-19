// Owner-authorized PR #94 release, 2026-10-19. No app writes or push tests.
// Plaintext exports stay on the ephemeral runner; only authenticated ciphertext
// and aggregate/schema evidence may be uploaded as Actions artifacts.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, createCipheriv, publicEncrypt, constants } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
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
const output = 'runtime-evidence/pr94-release';
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
const migrations = ['0011_person_birthdays.sql'];
const migrationHash = 'b278ebeae969e1a80e0d5ba2a1edc0b61b40653129b5c2e9aab5ca3553361466';
if (sha(readFileSync('db/migrations/' + migrations[0])) !== migrationHash) throw new Error('Approved migration changed');
const allMigrations = readdirSync('db/migrations').filter(name => name.endsWith('.sql')).sort();
if (allMigrations.length !== 11 || allMigrations.some((name, i) => !name.startsWith(String(i + 1).padStart(4, '0') + '_'))) throw new Error('Unexpected local migration set');
if (phase !== 'verify') {
  if (process.env.GITHUB_REF !== 'refs/heads/feat/daily-life-and-multi-image-20261018') throw new Error('Release branch mismatch');
  if (Date.now() > Date.parse('2026-10-20T14:59:59Z')) throw new Error('Release window ended');
  const changed = execFileSync('git', ['diff', '--name-only', 'a3daf894b4512153614cb97bfb5348468c9aedf9', 'HEAD'], {encoding:'utf8'}).trim().split('\n').filter(Boolean);
  const allowed = ['scripts/release-pr94-production.mjs','scripts/verify-pr94-production-readonly.mjs','.github/workflows/release-pr94-production.yml','.github/workflows/verify-ui-deployment.yml','docs/daily-life-release.md'];
  if (changed.some(path => !allowed.includes(path))) throw new Error('Application differs from accepted a3daf894');
}
const protectedTables = ['people', 'schedules', 'places', 'push_subscriptions', 'notification_settings', 'saved_commute_routes', 'saved_commute_route_vias', 'saved_commute_route_origins', 'saved_commute_route_destinations', 'transit_access_points', 'commute_preferences', 'commute_preference_steps', 'approved_workbook_import_receipts', 'approved_workbook_import_checks'];
async function coreSnapshot(projections) {
  const tables = [];
  for (const table of protectedTables) {
    const columns = projections?.[table] ?? (await query('PRAGMA table_info("' + table + '")')).map(row => row.name).filter(name => !(table === 'people' && ['phone','birthday_json'].includes(name)) && !(table === 'notification_settings' && name === 'birthday_days_json'));
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
if (project.source?.config?.production_deployments_enabled !== true) throw new Error('Canonical production deployment is disabled');
const schedulerSettings = await cf('/workers/scripts/come-back-home-runtime/settings');
const schedulerSchedules = await cf('/workers/scripts/come-back-home-runtime/schedules');
const schedulerDeployments = await cf('/workers/scripts/come-back-home-runtime/deployments');
const schedulerOrigin = schedulerSettings.bindings?.find(binding => binding.name === 'PAGES_ORIGIN')?.text;
const crons = (schedulerSchedules.schedules ?? []).map(item => item.cron);
if (schedulerOrigin !== 'https://come-back-home.pages.dev' || JSON.stringify(crons) !== JSON.stringify(['* * * * *'])) throw new Error('Existing scheduler target/Cron mismatch');
const before = await coreSnapshot();
const ledger = (await query('SELECT name FROM d1_migrations ORDER BY name')).map(row => row.name);
if (ledger.length < 10 || ledger.length > 11 || ledger.some((name,i) => name !== allMigrations[i])) throw new Error('Unexpected production migration baseline');
const pending = allMigrations.filter(name => !ledger.includes(name));
if (pending.length && JSON.stringify(pending) !== JSON.stringify(migrations)) throw new Error('0011 must be the sole pending migration');
async function verifySchema() {
  const peopleColumns = await query('PRAGMA table_info(people)');
  const settingsColumns = await query('PRAGMA table_info(notification_settings)');
  if (!['phone','birthday_json'].every(name => peopleColumns.some(c => c.name === name && c.type === 'TEXT' && c.notnull === 0))) throw new Error('Person profile schema mismatch');
  const birthday = settingsColumns.find(c => c.name === 'birthday_days_json');
  if (!birthday || birthday.type !== 'TEXT' || birthday.notnull !== 1 || birthday.dflt_value !== "'[]'") throw new Error('Birthday settings default mismatch');
  if ((await query('PRAGMA quick_check'))[0]?.quick_check !== 'ok' || (await query('PRAGMA foreign_key_check')).length) throw new Error('D1 integrity check failed');
  return {phoneNullable:true,birthdayNullable:true,birthdayRemindersDefault:'[]',integrity:'ok'};
}
const report = {
  phase, sourceSha: process.env.GITHUB_SHA, checkedAt: new Date().toISOString(),
  canonicalOrigin: 'https://come-back-home.pages.dev',
  deploymentId: project.canonical_deployment?.id ?? null,
  scheduler: {origin:schedulerOrigin,crons,deployment:schedulerDeployments.deployments?.[0]?.id ?? null,versions:schedulerDeployments.deployments?.[0]?.versions?.map(item=>item.version_id) ?? [],changed:false},
  deployedCommit: project.canonical_deployment?.deployment_trigger?.metadata?.commit_hash ?? project.latest_deployment?.deployment_trigger?.metadata?.commit_hash ?? null,
  productionDeploymentsEnabled: project.source?.config?.production_deployments_enabled,
  priorMigrations: ledger, pendingMigrations: pending, core: before,
  duplicateNameGroups: (await query("SELECT COUNT(*) AS count FROM (SELECT lower(replace(trim(name),' ','')) AS normalized FROM people GROUP BY normalized HAVING COUNT(*) > 1)"))[0]?.count,
  pushConfigured: ['VAPID_PRIVATE_KEY','VAPID_PUBLIC_KEY'].every(key => Boolean(prod.env_vars?.[key])),
  migrationsSha256: Object.fromEntries(migrations.map(name => [name, sha(readFileSync('db/migrations/' + name))])),
  appWrites: 0, testNotificationsSent: 0, privateValuesPublished: false,
};
if (!pending.length) report.schema = await verifySchema();
if (phase === 'verify' && (pending.length || report.deployedCommit !== process.env.GITHUB_SHA)) throw new Error('Deployed schema/commit mismatch');
if (phase === 'preflight') {
  const sqlPath = join(tmpdir(), 'cbh-pr94-backup-' + process.pid + '.sql');
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
  if (!process.env.BACKUP_DRIVE_ID || !/^[a-f0-9]{64}$/.test(process.env.BACKUP_ENCRYPTED_SHA ?? '') || process.env.EXPECTED_CORE_SHA !== before.sha256) throw new Error('Verified durable backup or matching core fingerprint missing');
  report.backupDriveId = process.env.BACKUP_DRIVE_ID;
  report.backupEncryptedSha256 = process.env.BACKUP_ENCRYPTED_SHA;
  report.timeTravelBeforeMigration = JSON.parse(wrangler(['time-travel', 'info', db.database_name, '--json']));
  if (pending.length) wrangler(['migrations', 'apply', db.database_name, '--remote']);
  const after = await coreSnapshot(Object.fromEntries(before.tables.map(t => [t.table, t.columns])));
  if (before.sha256 !== after.sha256) throw new Error('Core-data readback changed; stop release and investigate without automatic restore');
  report.afterMigrations = (await query('SELECT name FROM d1_migrations ORDER BY name')).map(row => row.name);
  if (!migrations.every(name => report.afterMigrations.includes(name))) throw new Error('Migration ledger incomplete');
  report.coreDataPreserved = true;
  report.schema = await verifySchema();
  if (pending.length) {
    const nonDefaults = (await query("SELECT (SELECT COUNT(*) FROM people WHERE phone IS NOT NULL OR birthday_json IS NOT NULL) + (SELECT COUNT(*) FROM notification_settings WHERE birthday_days_json <> '[]') AS count"))[0]?.count;
    if (nonDefaults !== 0) throw new Error('New columns did not start empty/OFF');
    report.existingRowsDefaultOff = true;
  }
}
writeFileSync(output + '/' + phase + '.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ phase, result: 'PASS', sourceSha: report.sourceSha, pendingMigrations: pending, coreDataPreserved: report.coreDataPreserved ?? report.rehearsal?.protectedDataPreserved, encryptedBackupReady: Boolean(report.backup), privateValuesPublished: false }));
