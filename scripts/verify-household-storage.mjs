import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'vite';
const vite = await createServer({ appType: 'custom', logLevel: 'error', server: { middlewareMode: true } });
const sql = new DatabaseSync(':memory:');
const db = { prepare(source) { let args = []; return { bind(...v) { args = v; return this; }, query() { const bound = []; const text = source.replace(/\?(\d+)/g, (_, n) => { bound.push(args[Number(n) - 1]); return '?'; }); return [sql.prepare(text), bound]; }, async all() { const [q, a] = this.query(); return { results: q.all(...a), success: true }; }, async first() { return (await this.all()).results[0] ?? null; }, async run() { const [q, a] = this.query(); return /RETURNING/i.test(source) ? { success: true, results: q.all(...a) } : { success: true, meta: q.run(...a) }; } }; }, async batch(statements) { sql.exec('BEGIN'); try {
        const r = [];
        for (const s of statements)
            r.push(await s.run());
        sql.exec('COMMIT');
        return r;
    }
    catch (e) {
        sql.exec('ROLLBACK');
        throw e;
    } } };
let checks = 0;
const check = (v, e, m) => { assert.deepEqual(v, e, m); checks++; };
try {
    for (const file of (await readdir('db/migrations')).filter(x => x.endsWith('.sql')).sort())
        sql.exec(await readFile('db/migrations/' + file, 'utf8'));
    const { seal } = await vite.ssrLoadModule('/worker/modules/documents/drive.ts');
    const { handleHousehold } = await vite.ssrLoadModule('/worker/modules/household/service.ts');
    const { HouseholdSheets, cells } = await vite.ssrLoadModule('/worker/modules/household/sheets.ts');
    const env = { DB: db, PRIVATE_WORK_ENABLED: '1', PRIVATE_DRIVE_TOKEN_KEY: Buffer.alloc(32, 7).toString('base64'), PRIVATE_DRIVE_CLIENT_ID: 'synthetic-client', PRIVATE_DRIVE_CLIENT_SECRET: 'synthetic-secret' };
    const now = new Date().toISOString(), future = new Date(Date.now() + 86400000).toISOString();
    for (const [id, login, role] of [['fixture-admin', 'ydh1121', 'admin'], ['fixture-member', 'yvonne', 'member']]) {
        sql.prepare('INSERT INTO auth_users VALUES(?,?,?,0,0,0,?)').run(id, login, role, now);
        sql.prepare('INSERT INTO auth_sessions VALUES(?,?,0,?,0,?,?,?,NULL)').run(id + '-session', id, 'synthetic', now, now, future);
    }
    sql.prepare('INSERT INTO case_profiles VALUES(?,?,?)').run('fixture-case', 'fixture-member', now);
    sql.prepare('INSERT INTO case_drive_connections VALUES(?,?,?,?,?,?,?)').run('fixture-case', await seal('synthetic-refresh', env), 'synthetic-subject', 'private-root', '["private-owner"]', 'fixture-admin', now);
    const admin = { id: 'fixture-admin', loginId: 'ydh1121', role: 'admin', mustChangePassword: false, sessionHash: 'fixture-admin-session', authEpoch: 0 };
    const member = { ...admin, id: 'fixture-member', loginId: 'yvonne', role: 'member', sessionHash: 'fixture-member-session' };
    const files = new Map([['private-root', { id: 'private-root', name: 'Private synthetic root', mimeType: 'application/vnd.google-apps.folder' }]]), tabs = new Map();
    let created = 0, artCreated = 0, calls = 0, dropCommit = false, changePermissions = false;
    const binary = new Map();
    let nextBinary = 0;
    const response = (v, status = 200) => Response.json(v, { status });
    const fetcher = async (url, init = {}) => {
        calls++;
        const u = new URL(String(url));
        if (u.hostname === 'oauth2.googleapis.com')
            return response({ access_token: 'synthetic-access' });
        if (u.hostname === 'www.googleapis.com') {
            if (u.pathname === '/drive/v3/files/generateIds')
                return response({ ids: ['binary-fixture-' + (++nextBinary)] });
            if (u.pathname === '/upload/drive/v3/files') {
                const raw = await init.body.arrayBuffer(), decoded = new TextDecoder().decode(raw);
                const metadata = JSON.parse(decoded.split('\r\n\r\n')[1].split('\r\n--')[0]);
                const headerEnd = decoded.indexOf('\r\n\r\n', decoded.indexOf('\r\n--') + 4) + 4;
                const boundaryBytes = new TextEncoder().encode('\r\n--' + init.headers['Content-Type'].split('boundary=')[1] + '--').length;
                const data = raw.slice(new TextEncoder().encode(decoded.slice(0, headerEnd)).length, raw.byteLength - boundaryBytes);
                const sha = Buffer.from(await crypto.subtle.digest('SHA-256', data)).toString('hex');
                if (files.has(metadata.id))
                    return response({}, 409);
                files.set(metadata.id, { ...metadata, size: String(data.byteLength), sha256Checksum: sha });
                binary.set(metadata.id, data);
                artCreated++;
                return response({ id: metadata.id });
            }
            if (u.pathname === '/drive/v3/files' && init.method === 'POST') {
                const v = JSON.parse(init.body), id = 'synthetic-book-' + (++created);
                files.set(id, { ...v, id });
                return response({ id });
            }
            if (u.pathname === '/drive/v3/files') {
                const q = u.searchParams.get('q') ?? '';
                return response({ files: [...files.values()].filter(f => f.appProperties?.cbhHouseholdInit && q.includes(f.appProperties.cbhHouseholdInit)).map(f => ({ id: f.id })) });
            }
            const id = decodeURIComponent(u.pathname.split('/')[4]);
            if (!files.has(id))
                return response({}, 404);
            if (u.searchParams.get('alt') === 'media')
                return new Response(binary.get(id));
            if (u.pathname.endsWith('/permissions'))
                return response({ permissions: [{ id: 'private-owner', type: changePermissions ? 'anyone' : 'user', role: 'owner' }] });
            return response(files.get(id));
        }
        if (u.hostname === 'sheets.googleapis.com') {
            if (u.pathname.endsWith(':batchUpdate')) {
                const body = JSON.parse(init.body), next = new Map([...tabs].map(([k, v]) => [k, { ...v, rows: v.rows.map(r => r ? [...r] : r) }]));
                for (const r of body.requests) {
                    if (r.addSheet) {
                        const p = r.addSheet.properties;
                        if (next.has(p.sheetId))
                            throw new Error('duplicate tab');
                        next.set(p.sheetId, { title: p.title, rows: [] });
                    }
                    if (r.updateCells) {
                        const { range, rows } = r.updateCells;
                        const tab = next.get(range.sheetId);
                        if (!tab)
                            throw new Error('missing tab');
                        for (let j = 0; j < rows.length; j++) {
                            const target = tab.rows[range.startRowIndex + j] ??= [];
                            for (let i = 0; i < rows[j].values.length; i++) {
                                const cell = rows[j].values[i].userEnteredValue;
                                target[range.startColumnIndex + i] = cell.stringValue ?? cell.numberValue ?? cell.boolValue ?? cell.formulaValue ?? '';
                            }
                        }
                    }
                }
                tabs.clear();
                for (const [k, v] of next)
                    tabs.set(k, v);
                if (dropCommit) {
                    dropCommit = false;
                    throw new Error('synthetic response lost after atomic remote commit');
                }
                return response({ replies: [] });
            }
            const read = (range) => { const m = range.match(/^'([^']+)'!([A-Z]+)(\d+):([A-Z]+)(\d+)$/); if (!m)
                throw new Error('range ' + range); const tab = [...tabs.values()].find(t => t.title === m[1]); const letter = s => [...s].reduce((v, c) => v * 26 + c.charCodeAt(0) - 64, 0) - 1; return (tab?.rows ?? []).slice(+m[3] - 1, +m[5]).filter(Boolean).map(r => r.slice(letter(m[2]), letter(m[4]) + 1)); };
            if (u.pathname.endsWith('/values:batchGet'))
                return response({ valueRanges: u.searchParams.getAll('ranges').map(r => ({ range: r, values: read(r) })) });
            if (u.pathname.includes('/values/'))
                return response({ values: read(decodeURIComponent(u.pathname.split('/values/')[1])) });
            return response({ sheets: [...tabs].map(([sheetId, t]) => ({ properties: { sheetId, title: t.title } })) });
        }
        throw new Error('unexpected provider host ' + u.hostname);
    };
    const request = (path = '', body, headers = {}) => new Request('https://local.invalid/api/private/household' + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const invoke = (p, path = '', body, headers) => handleHousehold(request(path, body, headers), env, p, path.split('/').filter(Boolean), fetcher);
    const json = async (r) => r.json();
    check((await json(await invoke(admin))).ready, false, 'uninitialized empty view');
    const initialized = await json(await invoke(admin, '/initialize', {}));
    check(initialized.ready, true, 'private sheet initialized');
    check(created, 1, 'one workbook');
    check(initialized.snapshot.revision, 0, 'initial revision');
    check(initialized.snapshot.entries, [], 'empty ledger no seed personal data');
    for (const sheetId of [107,108,109,110]) { const summary=tabs.get(sheetId).rows[1][0]; check(summary.startsWith('=IF(COUNTA(장부!A2:A)=0,"",QUERY(') && !summary.includes('IFERROR(') && summary.endsWith(',0))'),true,'only empty ledger suppresses output; real formula failures remain visible'); }
    check((await json(await invoke(member))).snapshot, initialized.snapshot, 'both accounts read same workspace');
    const before304 = calls;
    check((await invoke(member, '', undefined, { 'If-None-Match': '"0"' })).status, 304, 'conditional shared private cache');
    check(calls - before304, 3, '304 rechecks token and private book but skips ledger');
    const card = { id: 'card-fixture', name: 'Fixture credit', kind: 'credit', limit: 100000, openingRemaining: 40000, orientation: 'landscape' };
    const cmd = (id, rev, event) => ({ id, expectedRevision: rev, event });
    const saved = await json(await invoke(member, '/events', cmd('operation-card', 0, { type: 'card.save', card })));
    check(saved.snapshot.cards.length, 1, 'card persisted');
    check(saved.snapshot.cards[0].createdBy, member.id, 'server derives actor');
    check(saved.revision, 1, 'one revision');
    const entry = { id: 'entry-fixture', kind: 'expense', amount: 3000, occurredAt: '2026-01-01T15:00:00Z', merchant: '=IMPORTXML("https://invalid.example","*")', category: 'Food', subcategory: 'Lunch', cardId: card.id };
    const command = cmd('operation-entry', 1, { type: 'entry.add', entry });
    const spent = await json(await invoke(admin, '/events', command));
    check(spent.snapshot.entries.length, 1, 'expense once');
    check(tabs.get(102).rows[1][5], entry.merchant, 'merchant stored literal, no evaluated formula');
    check(cells(['=1+1'])[0].userEnteredValue, { stringValue: '=1+1' }, 'typed string rejects formula injection');
    check(tabs.get(102).rows[1][12], '2026-01-02', 'KST day projected correctly');
    const retry = await json(await invoke(admin, '/events', command));
    check(retry.revision, 2, 'retry acknowledges original receipt');
    check(retry.snapshot.entries.length, 1, 'retry no double ledger expense');
    await assert.rejects(() => invoke(admin, '/events', { ...command, event: { type: 'entry.add', entry: { ...entry, amount: 4000 } } }), e => e.code === 'HOUSEHOLD_REVISION_CONFLICT');
    checks++;
    await assert.rejects(() => invoke(admin, '/events', cmd('other-stale', 0, { type: 'preferences.save', preferences: { dailyLedgerReminder: true, todoReminders: true } })), e => e.code === 'HOUSEHOLD_REVISION_CONFLICT');
    checks++;
    const repay = cmd('operation-repay', 2, { type: 'entry.add', entry: { id: 'repay-fixture', kind: 'repayment', amount: 2000, occurredAt: '2026-01-02T05:00:00Z', cardId: card.id } });
    dropCommit = true;
    await assert.rejects(() => invoke(member, '/events', repay), /response lost/);
    checks++;
    check(sql.prepare('SELECT pending_id FROM household_workspace').get().pending_id, repay.id, 'ambiguous write retained encrypted for recovery');
    const stored = sql.prepare('SELECT * FROM household_workspace').get();
    check(stored.pending_encrypted.includes('repayment'), false, 'no plain financial payload in coordination row');
    await assert.rejects(() => invoke(member, '/recover', {}), e => e.code === 'HOUSEHOLD_BUSY');
    checks++;
    sql.exec("UPDATE household_workspace SET lease_until='2000-01-01T00:00:00Z'");
    const originalRecoveredRow = [...tabs.get(102).rows[2]];
    const altered = JSON.parse(originalRecoveredRow[1]);
    altered.amount = 2500;
    tabs.get(102).rows[2][1] = JSON.stringify(altered);
    tabs.get(102).rows[2][4] = 2500;
    await assert.rejects(() => invoke(admin, '/recover', {}), e => e.code === 'HOUSEHOLD_SYNC_REQUIRED');
    checks++;
    check(sql.prepare('SELECT pending_id FROM household_workspace').get().pending_id, repay.id, 'tampered remote result never blessed as current');
    tabs.get(102).rows[2] = originalRecoveredRow;
    const recovered = await json(await invoke(admin, '/recover', {}));
    check(recovered.revision, 3, 'lost response reconciled');
    check(recovered.snapshot.entries.length, 2, 'recovery never reapplies repayment');
    check(recovered.snapshot.entries[1].createdBy, member.id, 'recovery retains original actor');
    check(sql.prepare('SELECT pending_encrypted FROM household_workspace').get().pending_encrypted, null, 'transient encrypted journal cleared after success');
    const historical = await json(await invoke(admin, '/events', command));
    check(historical.revision, 3, 'historical retry returns current snapshot');
    check(historical.snapshot.entries.length, 2, 'historical retry no new effect');
    await assert.rejects(() => invoke(admin, '/events', cmd(command.id, 3, { type: 'preferences.save', preferences: { dailyLedgerReminder: true, todoReminders: true } })), e => e.code === 'HOUSEHOLD_COMMAND_REUSED');
    checks++;
    const restored = await json(await invoke(admin, '/initialize', {}));
    check(restored.revision, 3, 'repeated initialize retains financial records');
    check(created, 1, 'repeated initialize no duplicatebook');
    changePermissions = true;
    await assert.rejects(() => invoke(member, '', undefined, { 'If-None-Match': '"3"' }), e => e.code === 'DRIVE_NOT_PRIVATE');
    checks++;
    changePermissions = false;
    tabs.get(102).rows[1][4] = 999;
    await assert.rejects(() => invoke(member), e => e.code === 'HOUSEHOLD_SHEET_EDITED');
    checks++;
    tabs.get(102).rows[1][4] = 3000;
    tabs.get(102).rows[1][1] = JSON.stringify({ ...spent.snapshot.entries[0], amount: 7000 });
    await assert.rejects(() => invoke(member), e => e.code === 'HOUSEHOLD_SHEET_EDITED');
    checks++;
    sql.exec("UPDATE auth_sessions SET revoked_at='2026-01-01' WHERE user_id='fixture-member'");
    await assert.rejects(() => invoke(member, '', undefined, { 'If-None-Match': '"3"' }), e => e.code === 'HOUSEHOLD_ACCESS_DENIED');
    checks++;
    tabs.get(102).rows[1][1] = JSON.stringify(spent.snapshot.entries[0]);
    const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    const imageRequest = (id = 'card-fixture', op = 'image-operation') => new Request('https://local.invalid/api/private/household/cards/' + id + '/art', { method: 'POST', headers: { 'Content-Type': 'image/png', 'X-CBH-Operation-ID': op }, body: imageBytes });
    await assert.rejects(() => handleHousehold(imageRequest('missing-card'), env, admin, ['cards', 'missing-card', 'art'], fetcher), e => e.code === 'HOUSEHOLD_CARD_NOT_FOUND');
    checks++;
    const uploaded = await json(await handleHousehold(imageRequest(), env, admin, ['cards', 'card-fixture', 'art'], fetcher));
    check(typeof uploaded.imageFileId, 'string', 'private artwork uploaded');
    check(artCreated, 1, 'one artwork object');
    const duplicateArt = await json(await handleHousehold(imageRequest(), env, admin, ['cards', 'card-fixture', 'art'], fetcher));
    check(duplicateArt.imageFileId, uploaded.imageFileId, 'upload retry uses reserved file ID');
    check(artCreated, 1, 'upload retry never duplicates image');
    await invoke(admin, '/events', cmd('operation-art-attach', 3, { type: 'card.save', card: { ...card, imageFileId: uploaded.imageFileId } }));
    const imageResponse = await handleHousehold(new Request('https://local.invalid/api/private/household/cards/card-fixture/art'), env, admin, ['cards', 'card-fixture', 'art'], fetcher);
    check(new Uint8Array(await imageResponse.arrayBuffer()), imageBytes, 'authenticated image is exact verified bytes');
    check(imageResponse.headers.get('Cache-Control'), 'private, no-store', 'artwork never cached publicly');
    check((await new HouseholdSheets('synthetic', async () => response({ error: 'do not reflect' }, 403)).request('example').catch(e => e.code)), 'HOUSEHOLD_SHEETS_ACCESS_REQUIRED', 'provider permissions failure stays actionable and sanitized');
    console.log(JSON.stringify({ suite: 'household-private-sheets-storage', checks, status: 'PASS', liveProvider: false, productionWrites: 0 }));
}
finally {
    sql.close();
    await vite.close();
}
