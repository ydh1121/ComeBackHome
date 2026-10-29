import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, appendFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATABASE, DATABASE_ID, rows, LEDGER_QUERY, SCHEMA_QUERY } from './prepare-login-db.mjs';
import { REVIEWED_SOURCES, validateHouseholdSource } from './prepare-household-db.mjs';
import { TRANSIT_CACHE_MIGRATION, TRANSIT_CACHE_SHA256 } from './reviewed-transit-cache-source.mjs';

export const CONFIRMATION = 'APPLY_REMOTE_COMEBACKHOME_TRANSIT_CACHE_0016';
export const BATCH = 'transit-cache-0016';
export const MIGRATION = TRANSIT_CACHE_MIGRATION;
const requireState = (ok, code) => { if (!ok) throw new Error(code); };
const appSchema = schema => schema.filter(o => o.name !== 'd1_migrations')
  .map(o => ({ type: o.type, name: o.name, tbl_name: o.tbl_name, sql: (o.sql ?? '').replace(/\s+/g, ' ').trim() }))
  .sort((a, b) => `${a.type}:${a.name}`.localeCompare(`${b.type}:${b.name}`));

export function validateTransitCacheSource(config, files, sources) {
  requireState(JSON.stringify(files) === JSON.stringify([...Object.keys(REVIEWED_SOURCES), MIGRATION]), 'UNEXPECTED_REPOSITORY_MIGRATIONS');
  // This verifies every immutable source and constructs both schemas locally.
  const reviewed = validateHouseholdSource(config, files, sources);
  return { files, baseline: reviewed.complete, complete: reviewed.cacheComplete };
}

export function assessTransitCacheState(ledger, schema, source) {
  const names = ledger.map(row => row.name);
  requireState(new Set(names).size === names.length && names.every((name, i) => name === source.files[i]) &&
    (names.length === 15 || names.length === 16), 'UNEXPECTED_REMOTE_MIGRATIONS');
  const pending = names.length === 15;
  requireState(JSON.stringify(appSchema(schema)) === JSON.stringify(appSchema(pending ? source.baseline : source.complete)),
    pending ? 'BASELINE_OR_PARTIAL_SCHEMA_MISMATCH' : 'TRANSIT_CACHE_SCHEMA_INCOMPLETE');
  return pending ? 'pending' : 'applied';
}

export async function prepareTransitCacheDb({ source, query, bookmark, recordRecovery, apply }) {
  const beforeLedger = await query(LEDGER_QUERY), beforeSchema = await query(SCHEMA_QUERY);
  if (assessTransitCacheState(beforeLedger, beforeSchema, source) === 'applied')
    return { schema: 'already-applied', applied: [], preservedExistingSchema: true };
  const recoveryAt = new Date().toISOString();
  const recovery = await bookmark(recoveryAt);
  requireState(typeof recovery?.bookmark === 'string' && /^[0-9a-f]+(?:-[0-9a-f]+){3}$/i.test(recovery.bookmark), 'RECOVERY_POINT_UNAVAILABLE');
  await recordRecovery(recoveryAt);
  requireState(JSON.stringify(await query(LEDGER_QUERY)) === JSON.stringify(beforeLedger) &&
    JSON.stringify(await query(SCHEMA_QUERY)) === JSON.stringify(beforeSchema), 'SCHEMA_CHANGED_DURING_PREFLIGHT');
  await apply([MIGRATION]);
  const afterLedger = await query(LEDGER_QUERY), afterSchema = await query(SCHEMA_QUERY);
  requireState(assessTransitCacheState(afterLedger, afterSchema, source) === 'applied', 'MIGRATION_NOT_APPLIED');
  const oldNames = new Set(beforeSchema.map(o => o.type + ':' + o.name));
  requireState(JSON.stringify(appSchema(beforeSchema)) === JSON.stringify(appSchema(afterSchema.filter(o => oldNames.has(o.type + ':' + o.name)))), 'EXISTING_SCHEMA_CHANGED');
  return { schema: 'applied', applied: [MIGRATION], recoveryAt, preservedExistingSchema: true };
}

export function createScopedFiles(config, sources) {
  requireState(typeof sources[MIGRATION] === 'string' &&
    createHash('sha256').update(sources[MIGRATION]).digest('hex') === TRANSIT_CACHE_SHA256, 'UNREVIEWED_MIGRATION');
  const directory = mkdtempSync(join(tmpdir(), 'cbh-reviewed-transit-cache-'));
  try {
    mkdirSync(join(directory, 'migrations'));
    writeFileSync(join(directory, 'migrations', MIGRATION), sources[MIGRATION], { mode: 0o600 });
    const scoped = {
      name: 'come-back-home', compatibility_date: config.compatibility_date,
      d1_databases: [{ binding: 'DB', database_name: DATABASE, database_id: DATABASE_ID, migrations_dir: 'migrations' }],
    };
    const path = join(directory, 'wrangler.json');
    writeFileSync(path, JSON.stringify(scoped), { mode: 0o600 });
    return { path, directory, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function main(env = process.env) {
  requireState(env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
    env.GITHUB_REPOSITORY === 'ydh1121/ComeBackHome' && env.CBH_D1_BATCH === BATCH && env.CBH_D1_CONFIRMATION === CONFIRMATION, 'OWNER_DISPATCH_REQUIRED');
  requireState(/^[a-f0-9]{40}$/.test(env.CBH_EXPECTED_SHA ?? '') && env.CBH_EXPECTED_SHA === env.GITHUB_SHA, 'REVIEWED_COMMIT_REQUIRED');
  requireState(!!env.CLOUDFLARE_API_TOKEN && !!env.CLOUDFLARE_ACCOUNT_ID, 'EXISTING_CLOUDFLARE_ACTION_SECRETS_MISSING');
  const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
  const files = readdirSync('db/migrations').filter(name => name.endsWith('.sql')).sort();
  const sources = Object.fromEntries(files.map(name => [name, readFileSync('db/migrations/' + name, 'utf8')]));
  const source = validateTransitCacheSource(config, files, sources);
  const wranglerPath = resolve('node_modules/wrangler/bin/wrangler.js');
  const run = (args, failure, configPath = resolve('wrangler.jsonc')) => {
    try {
      return execFileSync(process.execPath, [wranglerPath, ...args, '--config', configPath], {
        encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024,
        env: { ...env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch { throw new Error(failure); }
  };
  const summary = text => {
    requireState(!!env.GITHUB_STEP_SUMMARY, 'RECOVERY_RECORD_DESTINATION_MISSING');
    appendFileSync(env.GITHUB_STEP_SUMMARY, text);
  };
  const result = await prepareTransitCacheDb({
    source,
    query: async sql => rows(JSON.parse(run(['d1', 'execute', DATABASE, '--remote', '--command', sql, '--json'], 'REMOTE_SCHEMA_READ_FAILED'))),
    bookmark: async timestamp => JSON.parse(run(['d1', 'time-travel', 'info', DATABASE, '--timestamp', timestamp, '--json'], 'RECOVERY_POINT_READ_FAILED')),
    recordRecovery: async timestamp => summary(`## 교통 조회 캐시 적용 전 복구 확인\n\n- 검수 커밋: ${env.CBH_EXPECTED_SHA}\n- DB: ${DATABASE}\n- 복구 기준 UTC: ${timestamp}\n- Time Travel 조회 성공. 복구는 실행하지 않았습니다.\n\n`),
    apply: async names => {
      requireState(JSON.stringify(names) === JSON.stringify([MIGRATION]), 'UNAPPROVED_BATCH');
      const scoped = createScopedFiles(config, sources);
      try {
        run(['d1', 'migrations', 'apply', DATABASE, '--remote'], 'MIGRATION_APPLY_FAILED_INSPECT_STATE', scoped.path);
      } finally { scoped.cleanup(); }
    },
  });
  summary(`## 교통 조회 캐시 DB 준비 결과\n\n- 상태: ${result.schema}\n- 적용: ${result.applied.join(', ') || '없음 (이미 적용됨)'}\n- 기존 일정·계정·산재·생활비 테이블 구조: 보존\n- 사용자 기록, 외부 교통 조회, 알림 발송 없음\n- 운영 코드 배포와 기기 검증은 별도 단계입니다.\n\n`);
  console.log(JSON.stringify(result));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
