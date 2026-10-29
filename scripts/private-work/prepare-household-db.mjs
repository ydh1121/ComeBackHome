import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, appendFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { DATABASE, DATABASE_ID, rows, LEDGER_QUERY, SCHEMA_QUERY } from './prepare-login-db.mjs';
import { TRANSIT_CACHE_MIGRATION, TRANSIT_CACHE_SHA256 } from './reviewed-transit-cache-source.mjs';
export const CONFIRMATION = 'APPLY_REMOTE_COMEBACKHOME_HOUSEHOLD_0013_0015';
export const BATCH = 'household-0013-0015';
export const REVIEWED_SOURCES = Object.freeze({
    '0001_initial.sql': '83c6ceb17840734dfd387735b8384f4a2d790a167e57e24b2645709194c96732',
    '0002_notification_planner_state.sql': 'bb34644831ff5cbc63023dd767b08b4b451e4ec43b04ff01c076ff85c1872630',
    '0003_presence_notification_settings.sql': 'f3cef99c14bf542e33966e88b517986f3bde3950e13559c428d0ce5b22c6e771',
    '0004_saved_commute_routes.sql': 'b642eb463859feeebf44ebda7a57c7248223e0d27c65971e9c8839db05bfcf22',
    '0005_presence_state.sql': '4bf4cb801f4fb18b0b0f335587522aa051a0c86f5b0da546390715d3d03c4413',
    '0006_saved_route_destination_access.sql': 'e65f39b783cdc84135ed1bef6681cd08e927ee9b9a83b5270cfd72af8f6bf8e1',
    '0007_multi_access_route_sets.sql': 'ec2dc4b9c99f6868f7872acc7cef3d7e5460f54d8ada40715889d6e8824d46a8',
    '0008_weekly_ocr_break_minutes.sql': '0e166aa0184f4d7e94ccc927446e6b08a30d94bdae87c5e54bdbe75fd52cb504',
    '0009_approved_workbook_import_receipts.sql': '80df593e409bccc4a28a27114863705dafacc5e35808519c6b282c778fe67e04',
    '0010_arrival_advance_notification.sql': '43aaf2141f0cf431d3b39d8b8b68e0dcf2575cb7f5442b1152089d59cb311153',
    '0011_person_birthdays.sql': 'b278ebeae969e1a80e0d5ba2a1edc0b61b40653129b5c2e9aab5ca3553361466',
    '0012_private_work_modules.sql': '759ee4c3f7526bf2b70582dffe79796d0e6d5f83e255d34eb4bd61cacf12f62e',
    '0013_household_workspace.sql': '761df4ece409cc97c9ae86bc54dccfee1a8b710959aee4ffbe67fee57aed8447',
    '0014_chat_exchanges.sql': '59523bf4119c3c9de21623b2530edbd88611f99e1ab4515fe8fb7d5c93fabf53',
    '0015_household_notifications.sql': 'c18c8304c998c06a26506c9b4b7b89b6f5c65a4dbff11fd606440430ec96386b',
});
export const MIGRATIONS = Object.freeze(Object.keys(REVIEWED_SOURCES).slice(12));
const requireState = (ok, code) => { if (!ok)
    throw new Error(code); };
const normalized = value => value.replace(/\s+/g, ' ').trim();
const appSchema = schema => schema.filter(o => o.name !== 'd1_migrations').map(o => ({ type: o.type, name: o.name, tbl_name: o.tbl_name, sql: normalized(o.sql ?? '') })).sort((a, b) => `${a.type}:${a.name}`.localeCompare(`${b.type}:${b.name}`));
export function validateHouseholdSource(config, files, sources) {
    const db = config.d1_databases?.[0];
    requireState(config.name === 'come-back-home' && config.d1_databases?.length === 1 && db.binding === 'DB' && db.database_name === DATABASE && db.database_id === DATABASE_ID && db.migrations_dir === 'db/migrations' && !db.migrations_table && !db.migrations_pattern, 'CANONICAL_DATABASE_MISMATCH');
    const reviewed = { ...REVIEWED_SOURCES, [TRANSIT_CACHE_MIGRATION]: TRANSIT_CACHE_SHA256 };
    const includesCache = files.length === Object.keys(reviewed).length;
    requireState(JSON.stringify(files) === JSON.stringify(Object.keys(includesCache ? reviewed : REVIEWED_SOURCES)), 'UNEXPECTED_REPOSITORY_MIGRATIONS');
    for (const name of files)
        requireState(typeof sources[name] === 'string' && createHash('sha256').update(sources[name]).digest('hex') === reviewed[name], 'UNREVIEWED_MIGRATION');
    // Build expected definitions locally from the immutable reviewed SQL. No
    // production rows or credentials enter this rehearsal database.
    const local = new DatabaseSync(':memory:');
    let baseline, complete;
    try {
        for (const [i, name] of files.entries()) {
            local.exec(sources[name]);
            if (i === 11)
                baseline = local.prepare(SCHEMA_QUERY).all();
            if (i === 14)
                complete = local.prepare(SCHEMA_QUERY).all();
        }
        return { files, baseline, complete, cacheComplete: includesCache ? local.prepare(SCHEMA_QUERY).all() : null };
    }
    finally {
        local.close();
    }
}
export function assessHouseholdState(ledger, schema, source) {
    const names = ledger.map(r => r.name);
    requireState(new Set(names).size === names.length && names.every((name, i) => name === source.files[i]), 'UNEXPECTED_REMOTE_MIGRATIONS');
    if (names.length === 13 || names.length === 14)
        throw new Error('PARTIAL_HOUSEHOLD_BATCH_STOP');
    requireState(names.length === 12 || names.length === 15 || names.length === 16 && source.cacheComplete, 'UNEXPECTED_REMOTE_MIGRATIONS');
    const expected = names.length === 12 ? source.baseline : names.length === 16 ? source.cacheComplete : source.complete;
    requireState(JSON.stringify(appSchema(schema)) === JSON.stringify(appSchema(expected)), names.length === 12 ? 'BASELINE_OR_PARTIAL_SCHEMA_MISMATCH' : 'HOUSEHOLD_SCHEMA_INCOMPLETE');
    return names.length === 12 ? 'pending' : 'applied';
}
export async function prepareHouseholdDb({ source, query, bookmark, recordRecovery, apply }) {
    const beforeLedger = await query(LEDGER_QUERY), beforeSchema = await query(SCHEMA_QUERY);
    const status = assessHouseholdState(beforeLedger, beforeSchema, source);
    if (status === 'applied')
        return { schema: 'already-applied', applied: [], preservedExistingSchema: true };
    const recoveryAt = new Date().toISOString(), recovery = await bookmark(recoveryAt);
    requireState(typeof recovery?.bookmark === 'string' && /^[0-9a-f]+(?:-[0-9a-f]+){3}$/i.test(recovery.bookmark), 'RECOVERY_POINT_UNAVAILABLE');
    await recordRecovery(recoveryAt);
    requireState(JSON.stringify(await query(LEDGER_QUERY)) === JSON.stringify(beforeLedger) && JSON.stringify(await query(SCHEMA_QUERY)) === JSON.stringify(beforeSchema), 'SCHEMA_CHANGED_DURING_PREFLIGHT');
    // The callback is pointed at a temporary directory containing these THREE
    // files only, never the repository's broad migrations directory.
    await apply([...MIGRATIONS]);
    const afterLedger = await query(LEDGER_QUERY), afterSchema = await query(SCHEMA_QUERY);
    requireState(assessHouseholdState(afterLedger, afterSchema, source) === 'applied', 'MIGRATION_NOT_APPLIED');
    const oldNames = new Set(beforeSchema.map(o => o.type + ':' + o.name));
    requireState(JSON.stringify(appSchema(beforeSchema)) === JSON.stringify(appSchema(afterSchema.filter(o => oldNames.has(o.type + ':' + o.name)))), 'EXISTING_SCHEMA_CHANGED');
    return { schema: 'applied', applied: [...MIGRATIONS], recoveryAt, preservedExistingSchema: true };
}
export function createScopedFiles(config, sources) {
    const directory = mkdtempSync(join(tmpdir(), 'cbh-reviewed-household-'));
    try {
        mkdirSync(join(directory, 'migrations'));
        for (const name of MIGRATIONS) {
            requireState(typeof sources[name] === 'string' && createHash('sha256').update(sources[name]).digest('hex') === REVIEWED_SOURCES[name], 'UNREVIEWED_MIGRATION');
            writeFileSync(join(directory, 'migrations', name), sources[name], { mode: 0o600 });
        }
        // No deploy entry point, vars, assets or other DBs in the temporary runner.
        const scoped = { name: config.name, compatibility_date: config.compatibility_date, d1_databases: [{ binding: 'DB', database_name: DATABASE, database_id: DATABASE_ID, migrations_dir: 'migrations' }] };
        const path = join(directory, 'wrangler.json');
        writeFileSync(path, JSON.stringify(scoped), { mode: 0o600 });
        return { path, directory, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
    }
    catch (error) {
        rmSync(directory, { recursive: true, force: true });
        throw error;
    }
}
export async function main(env = process.env) {
    requireState(env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REPOSITORY === 'ydh1121/ComeBackHome' && env.CBH_D1_BATCH === BATCH && env.CBH_D1_CONFIRMATION === CONFIRMATION, 'OWNER_DISPATCH_REQUIRED');
    requireState(/^[a-f0-9]{40}$/.test(env.CBH_EXPECTED_SHA ?? '') && env.CBH_EXPECTED_SHA === env.GITHUB_SHA, 'REVIEWED_COMMIT_REQUIRED');
    requireState(!!env.CLOUDFLARE_API_TOKEN && !!env.CLOUDFLARE_ACCOUNT_ID, 'EXISTING_CLOUDFLARE_ACTION_SECRETS_MISSING');
    const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8')), files = readdirSync('db/migrations').filter(n => n.endsWith('.sql')).sort();
    const sources = Object.fromEntries(files.map(n => [n, readFileSync('db/migrations/' + n, 'utf8')]));
    const source = validateHouseholdSource(config, files, sources);
    const wranglerPath = resolve('node_modules/wrangler/bin/wrangler.js');
    const run = (args, failure, configPath = resolve('wrangler.jsonc')) => { try {
        return execFileSync(process.execPath, [wranglerPath, ...args, '--config', configPath], { encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024, env: { ...env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    }
    catch {
        throw new Error(failure);
    } };
    const summary = text => { requireState(!!env.GITHUB_STEP_SUMMARY, 'RECOVERY_RECORD_DESTINATION_MISSING'); appendFileSync(env.GITHUB_STEP_SUMMARY, text); };
    const result = await prepareHouseholdDb({ source,
        query: async (sql) => rows(JSON.parse(run(['d1', 'execute', DATABASE, '--remote', '--command', sql, '--json'], 'REMOTE_SCHEMA_READ_FAILED'))),
        bookmark: async (timestamp) => JSON.parse(run(['d1', 'time-travel', 'info', DATABASE, '--timestamp', timestamp, '--json'], 'RECOVERY_POINT_READ_FAILED')),
        recordRecovery: async (timestamp) => summary(`## 생활비·자료 답변 DB 적용 전 복구 확인\n\n- 검수 커밋: ${env.CBH_EXPECTED_SHA}\n- DB: ${DATABASE}\n- 복구 기준 UTC: ${timestamp}\n- Time Travel 조회 성공. 복구 작업은 실행하지 않습니다.\n\n`),
        apply: async (names) => { requireState(JSON.stringify(names) === JSON.stringify(MIGRATIONS), 'UNAPPROVED_BATCH'); const scoped = createScopedFiles(config, sources); try {
            run(['d1', 'migrations', 'apply', DATABASE, '--remote'], 'MIGRATION_APPLY_FAILED_INSPECT_PARTIAL_BATCH', scoped.path);
        }
        finally {
            scoped.cleanup();
        } },
    });
    summary(`## DB 준비 결과\n\n- 상태: ${result.schema}\n- 적용: ${result.applied.join(', ') || '없음 (이미 적용됨)'}\n- 기존 일정·로그인·산재 테이블 구조: 보존\n- 신규 계정, 금융 기록, Drive 파일, 알림은 생성하지 않았습니다.\n- 운영 코드 배포와 실제 화면 확인은 별도 단계입니다.\n\n`);
    console.log(JSON.stringify(result));
    return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
