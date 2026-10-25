import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Owner-triggered setup only. Never called by the application, a push, or a PR job.
export const DATABASE = 'come-back-home-db';
export const DATABASE_ID = '5b5d6397-042c-465b-8411-9e67555eaeb4';
export const MIGRATION = '0012_private_work_modules.sql';
const MIGRATION_SHA256 = '759ee4c3f7526bf2b70582dffe79796d0e6d5f83e255d34eb4bd61cacf12f62e';
export const CONFIRMATION = 'APPLY_REMOTE_COMEBACKHOME_D1';
export const LEDGER_QUERY = 'SELECT name FROM d1_migrations ORDER BY name;';
export const SCHEMA_QUERY = "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name;";
export const POLICY_QUERY = "SELECT COUNT(*) AS ready FROM auth_policy WHERE id='default' AND session_hours=12 AND remembered_days=30 AND idle_hours=168;";
const LEGACY_TABLES = ['people', 'schedules', 'places', 'notification_settings', 'push_subscriptions', 'notification_jobs', 'notification_planner_state', 'saved_commute_routes', 'saved_commute_route_vias', 'saved_commute_route_origins', 'saved_commute_route_destinations', 'presence_state'];

function requireState(ok, code) { if (!ok) throw new Error(code); }

export function validateSource(config, files, sql) {
  const db = config.d1_databases?.[0];
  requireState(config.name === 'come-back-home' && config.d1_databases?.length === 1 &&
    db.binding === 'DB' && db.database_name === DATABASE && db.database_id === DATABASE_ID &&
    db.migrations_dir === 'db/migrations' && !db.migrations_table, 'CANONICAL_DATABASE_MISMATCH');
  requireState(createHash('sha256').update(sql).digest('hex') === MIGRATION_SHA256, 'UNREVIEWED_MIGRATION');
  requireState(files.length === 12 && files[11] === MIGRATION &&
    files.every((f, i) => f.startsWith(String(i + 1).padStart(4, '0') + '_')), 'UNEXPECTED_REPOSITORY_MIGRATIONS');
  return [...sql.matchAll(/CREATE (TABLE|INDEX|TRIGGER) (\w+)/g)].map((m) => ({ type: m[1].toLowerCase(), name: m[2] }));
}

export function rows(payload) {
  requireState(Array.isArray(payload) && payload.length === 1 && payload[0]?.success === true &&
    Array.isArray(payload[0].results), 'INVALID_D1_QUERY_RESULT');
  return payload[0].results;
}

function isPrivate(object) { return /^(auth_|case_)/.test(object.name) || /^(auth_|case_)/.test(object.tbl_name); }

export function assessState(ledger, schema, files, objects) {
  const names = ledger.map((r) => r.name);
  requireState(new Set(names).size === names.length &&
    names.every((name, i) => name === files[i]) &&
    (names.length === 11 || names.length === 12), 'UNEXPECTED_REMOTE_MIGRATIONS');
  requireState(LEGACY_TABLES.every((name) => schema.some((o) => o.type === 'table' && o.name === name)), 'LEGACY_SCHEMA_INCOMPLETE');
  if (names.length === 11) {
    requireState(!schema.some(isPrivate), 'PARTIAL_PRIVATE_SCHEMA_STOP');
    return 'pending';
  }
  requireState(objects.every((o) => schema.some((s) => s.type === o.type && s.name === o.name)), 'PRIVATE_SCHEMA_INCOMPLETE');
  return 'applied';
}

// Injected transport makes failure/order/zero-write cases testable without credentials.
export async function prepareLoginDb({ files, objects, query, bookmark, apply, recordRecovery }) {
  const beforeLedger = await query(LEDGER_QUERY);
  const beforeSchema = await query(SCHEMA_QUERY);
  const state = assessState(beforeLedger, beforeSchema, files, objects);
  if (state === 'applied') return { schema: 'already-applied', applied: [], accountSetup: 'not-verified' };

  const recoveryAt = new Date().toISOString();
  const recovery = await bookmark(recoveryAt);
  requireState(typeof recovery?.bookmark === 'string' && /^[0-9a-f]+(?:-[0-9a-f]+){3}$/i.test(recovery.bookmark), 'RECOVERY_POINT_UNAVAILABLE');
  // Persist only the timestamp. The opaque bookmark and DB rows are never published.
  await recordRecovery(recoveryAt);
  requireState(JSON.stringify(await query(LEDGER_QUERY)) === JSON.stringify(beforeLedger) &&
    JSON.stringify(await query(SCHEMA_QUERY)) === JSON.stringify(beforeSchema), 'SCHEMA_CHANGED_DURING_PREFLIGHT');
  await apply(); // Only 0012 can be pending after the exact ledger + source checks.
  const afterLedger = await query(LEDGER_QUERY);
  const afterSchema = await query(SCHEMA_QUERY);
  requireState(assessState(afterLedger, afterSchema, files, objects) === 'applied', 'MIGRATION_NOT_APPLIED');
  requireState(JSON.stringify(beforeSchema.filter((o) => !isPrivate(o))) ===
    JSON.stringify(afterSchema.filter((o) => !isPrivate(o))), 'LEGACY_SCHEMA_CHANGED');
  const policy = await query(POLICY_QUERY);
  requireState(policy.length === 1 && policy[0].ready === 1, 'INITIAL_AUTH_POLICY_MISSING');
  return { schema: 'applied', applied: [MIGRATION], recoveryAt, accountSetup: 'required-on-owner-pc' };
}

export async function main(env = process.env) {
  requireState(env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
    env.GITHUB_REPOSITORY === 'ydh1121/ComeBackHome' && env.CBH_D1_CONFIRMATION === CONFIRMATION, 'OWNER_DISPATCH_REQUIRED');
  requireState(!!env.CLOUDFLARE_API_TOKEN && !!env.CLOUDFLARE_ACCOUNT_ID, 'EXISTING_CLOUDFLARE_ACTION_SECRETS_MISSING');
  const files = readdirSync('db/migrations').filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const objects = validateSource(JSON.parse(readFileSync('wrangler.jsonc', 'utf8')), files, readFileSync('db/migrations/' + MIGRATION, 'utf8'));
  function wrangler(args, failure) {
    try {
      return execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args, '--config', 'wrangler.jsonc'], {
        encoding: 'utf8', timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
        env: { ...env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch { throw new Error(failure); } // No token, query output, or credential material in public logs.
  }
  const summary = (text) => {
    requireState(!!env.GITHUB_STEP_SUMMARY, 'RECOVERY_RECORD_DESTINATION_MISSING');
    appendFileSync(env.GITHUB_STEP_SUMMARY, text);
  };
  const result = await prepareLoginDb({
    files, objects,
    query: async (sql) => rows(JSON.parse(wrangler(['d1', 'execute', DATABASE, '--remote', '--command', sql, '--json'], 'REMOTE_SCHEMA_READ_FAILED'))),
    bookmark: async (timestamp) => JSON.parse(wrangler(['d1', 'time-travel', 'info', DATABASE, '--timestamp', timestamp, '--json'], 'RECOVERY_POINT_READ_FAILED')),
    recordRecovery: async (timestamp) => summary(`## DB 변경 전 복구 시점\n\n- DB: ${DATABASE}\n- UTC: ${timestamp}\n- D1 Time Travel 조회 성공. Free 보관 기간은 7일.\n- 자동 복구는 수행하지 않습니다.\n\n`),
    apply: async () => { wrangler(['d1', 'migrations', 'apply', DATABASE, '--remote'], 'MIGRATION_APPLY_FAILED_DO_NOT_REPEAT_ACCOUNT_SQL'); },
  });
  summary(`## 로그인 DB 준비 결과\n\n- Schema: ${result.schema}\n- 적용: ${result.applied.join(', ') || '없음 (이미 적용됨)'}\n- 기존 일정 테이블 구조: 보존\n- **계정 등록과 실제 로그인: 아직 확인하지 않았습니다.**\n\n다음은 본인 Windows PC에 이미 보관한 계정 파일을 등록하는 단계입니다. 비밀번호나 해시 파일을 GitHub에 올리지 마세요.\n`);
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
