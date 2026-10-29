import { PrivateError, privateJson, readJson, readBounded, type PrivateEnv, type Principal } from '../auth/contracts';
import { digest } from '../auth/crypto';
import { refreshDriveToken, seal, unseal, validFilePrefix, type DriveConnection } from '../documents/drive';
import { HouseholdSheets } from './sheets';
import { applyHouseholdCommand, createHouseholdState, HouseholdError, parseHouseholdCommand, type HouseholdCommand, type HouseholdState } from '../../../src/modules/household/domain/model';
import { projectHouseholdReminders, handleHouseholdPushSubscription } from './notifications';
interface Workspace {
    id: string;
    root_id: string;
    connection_case_id: string;
    spreadsheet_id: string | null;
    initialization_id: string;
    revision: number;
    state_hash: string | null;
    pending_id: string | null;
    pending_encrypted: string | null;
    lease_token: string | null;
    lease_until: string | null;
    updated_at: string;
}
interface Pending {
    command: HouseholdCommand;
    hash: string;
    afterHash: string;
    actor: string;
    at: string;
}
const clock = () => new Date().toISOString();
const LEASE_MS = 5 * 60 * 1000; // Sheets processes each batch for at most 180 seconds.
const fileId = (v: string) => /^[A-Za-z0-9_-]{1,180}$/.test(v);
const authSql = `EXISTS(SELECT 1 FROM auth_users u JOIN auth_sessions s ON s.user_id=u.id CROSS JOIN auth_policy ap WHERE u.id=?1 AND u.disabled=0 AND u.must_change_password=0 AND u.login_id IN ('ydh1121','yvonne') AND u.auth_epoch=?2 AND s.token_hash=?3 AND s.auth_epoch=u.auth_epoch AND s.revoked_at IS NULL AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND julianday(s.last_seen_at)>julianday('now')-ap.idle_hours/24.0)`;
class HouseholdRepository {
    constructor(readonly env: PrivateEnv, readonly p: Principal) { }
    args() { return [this.p.id, this.p.authEpoch, this.p.sessionHash]; }
    async authorize() {
        const r = await this.env.DB.prepare(`SELECT 1 AS allowed WHERE ${authSql}`).bind(...this.args()).first();
        if (!r)
            throw new PrivateError(403, 'HOUSEHOLD_ACCESS_DENIED');
    }
    row() { return this.env.DB.prepare("SELECT * FROM household_workspace WHERE id='shared'").first<Workspace>(); }
    async connected(row: Workspace | null) {
        const c = await this.env.DB.prepare(row ? 'SELECT c.* FROM case_drive_connections c WHERE c.case_id=?1' : 'SELECT c.* FROM case_drive_connections c JOIN case_profiles p ON p.id=c.case_id JOIN auth_users u ON u.id=p.owner_id WHERE u.login_id=\'yvonne\' AND u.disabled=0 LIMIT 1').bind(...(row ? [row.connection_case_id] : [])).first<DriveConnection & {
            case_id: string;
        }>();
        if (!c || !c.folder_id)
            throw new PrivateError(409, 'DRIVE_FOLDER_REQUIRED');
        if (!fileId(c.folder_id) || row && row.root_id !== c.folder_id)
            throw new PrivateError(409, 'HOUSEHOLD_ROOT_CHANGED');
        return c;
    }
    async release(token: string) { await this.env.DB.prepare("UPDATE household_workspace SET lease_token=NULL,lease_until=NULL WHERE id='shared' AND lease_token=?1").bind(token).run(); }
    async acquire() {
        const token = crypto.randomUUID(), until = new Date(Date.now() + LEASE_MS).toISOString();
        const row = await this.env.DB.prepare(`UPDATE household_workspace SET lease_token=?4,lease_until=?5 WHERE id='shared' AND (lease_until IS NULL OR lease_until<?6) AND ${authSql} RETURNING *`).bind(...this.args(), token, until, clock()).first<Workspace>();
        if (!row)
            throw new PrivateError(409, 'HOUSEHOLD_BUSY');
        return { row, token };
    }
    async live(token: string) {
        const r = await this.env.DB.prepare(`SELECT 1 FROM household_workspace WHERE id='shared' AND lease_token=?4 AND lease_until>?5 AND ${authSql}`).bind(...this.args(), token, clock()).first();
        if (!r)
            throw new PrivateError(409, 'HOUSEHOLD_BUSY');
    }
}
function envelope(row: Workspace | null, state: HouseholdState | null, connected = true) { return { ready: !!row?.spreadsheet_id && !!row.state_hash, connected, snapshot: state, revision: row?.revision ?? 0, pending: !!row?.pending_id, spreadsheetUrl: row?.spreadsheet_id ? 'https://docs.google.com/spreadsheets/d/' + row.spreadsheet_id + '/edit' : null }; }
function canonical(value: unknown): string {
    if (Array.isArray(value))
        return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object')
        return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
    return JSON.stringify(value);
}
async function hashState(state: HouseholdState) { return digest(canonical(state)); }
async function checkedState(api: HouseholdSheets, row: Workspace) {
    const state = await api.read(row.spreadsheet_id!);
    if (state.revision !== row.revision || await hashState(state) !== row.state_hash)
        throw new PrivateError(409, 'HOUSEHOLD_SYNC_REQUIRED');
    return state;
}
async function workspaceApi(repo: HouseholdRepository, row: Workspace | null, fetcher: typeof fetch) { const c = await repo.connected(row); const api = new HouseholdSheets(await refreshDriveToken(c, repo.env, fetcher), fetcher); return { api, c, permissions: JSON.parse(c.permission_ids_json) as string[] }; }
async function initialize(repo: HouseholdRepository, fetcher: typeof fetch) {
    let row = await repo.row();
    const { api, c, permissions } = await workspaceApi(repo, row, fetcher);
    await api.drive.archiveFolder(c.folder_id, c.folder_id, permissions);
    if (!row) {
        await repo.env.DB.prepare(`INSERT INTO household_workspace(id,root_id,connection_case_id,initialization_id,updated_at) SELECT 'shared',?4,?5,?6,?7 WHERE ${authSql} ON CONFLICT(id) DO NOTHING`).bind(...repo.args(), c.folder_id, c.case_id, crypto.randomUUID(), clock()).run();
        row = await repo.row();
    }
    if (!row)
        throw new PrivateError(403, 'HOUSEHOLD_ACCESS_DENIED');
    const lock = await repo.acquire();
    row = lock.row;
    let uncertain = false;
    try {
        let id = row.spreadsheet_id;
        if (!id) {
            id = await api.locate(row.root_id, row.initialization_id);
            if (!id) {
                await repo.live(lock.token);
                uncertain = true;
                id = await api.create(row.root_id, row.initialization_id);
                uncertain = false;
            }
            await repo.env.DB.prepare("UPDATE household_workspace SET spreadsheet_id=?1 WHERE id='shared' AND lease_token=?2").bind(id, lock.token).run();
            row = { ...row, spreadsheet_id: id };
        }
        await api.privateBook(id, row.root_id, permissions);
        if (row.state_hash)
            return privateJson(envelope(row, await checkedState(api, row)), 200, { ETag: '"' + row.revision + '"' });
        const state = createHouseholdState();
        await repo.live(lock.token);
        uncertain = true;
        await api.initialize(id, state);
        uncertain = false;
        await projectHouseholdReminders(repo.env.DB, state);
        const stateHash = await hashState(state);
        await repo.env.DB.prepare("UPDATE household_workspace SET state_hash=?1,updated_at=?2 WHERE id='shared' AND lease_token=?3 AND state_hash IS NULL").bind(stateHash, clock(), lock.token).run();
        row = { ...row, state_hash: stateHash };
        return privateJson(envelope(row, state), 200, { ETag: '"0"' });
    }
    finally {
        if (!uncertain)
            await repo.release(lock.token);
    }
}
async function commit(repo: HouseholdRepository, command: HouseholdCommand | null, fetcher: typeof fetch) {
    const lock = await repo.acquire();
    let row = lock.row;
    let uncertain = false;
    try {
        if (!row.spreadsheet_id || !row.state_hash)
            throw new PrivateError(409, 'HOUSEHOLD_SETUP_REQUIRED');
        const { api, permissions } = await workspaceApi(repo, row, fetcher);
        await api.privateBook(row.spreadsheet_id, row.root_id, permissions);
        let pending: Pending;
        if (row.pending_encrypted) {
            pending = JSON.parse(await unseal(row.pending_encrypted, repo.env)) as Pending;
            if (command && command.id !== pending.command.id)
                throw new PrivateError(409, 'HOUSEHOLD_SYNC_REQUIRED');
            if (command && await digest(JSON.stringify(command)) !== pending.hash)
                throw new PrivateError(409, 'HOUSEHOLD_COMMAND_REUSED');
        }
        else {
            if (!command)
                throw new PrivateError(409, 'HOUSEHOLD_NOTHING_TO_RECOVER');
            const hash = await digest(JSON.stringify(command));
            if (command.expectedRevision < row.revision) {
                const receipt = await api.history(row.spreadsheet_id!, command.expectedRevision);
                if (receipt?.id === command.id && receipt.hash === hash)
                    return privateJson(envelope(row, await checkedState(api, row)), 200, { ETag: '"' + row.revision + '"' });
                throw new PrivateError(409, 'HOUSEHOLD_REVISION_CONFLICT');
            }
            if (command.expectedRevision !== row.revision)
                throw new PrivateError(409, 'HOUSEHOLD_REVISION_CONFLICT');
            if (await api.commandExists(row.spreadsheet_id, command.id))
                throw new PrivateError(409, 'HOUSEHOLD_COMMAND_REUSED');
            const before = await checkedState(api, row);
            validateCommandImage(command, before);
            // Validate before accepting a durable pending command.
            applyHouseholdCommand(before, command, repo.p.id, clock());
            if (command.event.type === 'card.save' && command.event.card.imageFileId) {
                await verifyCardImage(api, command.event.card.imageFileId, row.root_id, permissions, command.event.card.id);
            }
            const at = clock();
            const candidate = applyHouseholdCommand(before, command, repo.p.id, at);
            if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > 5 * 1024 * 1024)
                throw new PrivateError(409, 'HOUSEHOLD_ARCHIVE_REQUIRED');
            pending = { command, hash, afterHash: await hashState(candidate), actor: repo.p.id, at };
            const encrypted = await seal(JSON.stringify(pending), repo.env);
            await repo.live(lock.token);
            await repo.env.DB.prepare("UPDATE household_workspace SET pending_id=?1,pending_encrypted=?2 WHERE id='shared' AND lease_token=?3 AND pending_id IS NULL").bind(command.id, encrypted, lock.token).run();
            row = { ...row, pending_id: command.id, pending_encrypted: encrypted };
        }
        const before = await api.read(row.spreadsheet_id!);
        let after: HouseholdState;
        if (before.revision === pending.command.expectedRevision + 1) {
            const receipt = await api.history(row.spreadsheet_id!, pending.command.expectedRevision);
            if (before.lastCommandId !== pending.command.id || receipt?.id !== pending.command.id || receipt.hash !== pending.hash || await hashState(before) !== pending.afterHash)
                throw new PrivateError(409, 'HOUSEHOLD_SYNC_REQUIRED');
            after = before;
        }
        else {
            if (before.revision !== row.revision || await hashState(before) !== row.state_hash)
                throw new PrivateError(409, 'HOUSEHOLD_SHEET_EDITED');
            after = applyHouseholdCommand(before, pending.command, pending.actor, pending.at);
            if (await hashState(after) !== pending.afterHash)
                throw new PrivateError(409, 'HOUSEHOLD_SYNC_REQUIRED');
            await repo.live(lock.token);
            uncertain = true;
            await api.commit(row.spreadsheet_id!, before, after, pending.command, pending.hash, pending.actor, pending.at);
            uncertain = false;
        }
        await projectHouseholdReminders(repo.env.DB, after);
        const hash = await hashState(after);
        await repo.live(lock.token);
        const saved = await repo.env.DB.prepare("UPDATE household_workspace SET revision=?1,state_hash=?2,pending_id=NULL,pending_encrypted=NULL,updated_at=?3 WHERE id='shared' AND lease_token=?4 AND pending_id=?5 RETURNING *").bind(after.revision, hash, clock(), lock.token, pending.command.id).first<Workspace>();
        if (!saved)
            throw new PrivateError(409, 'HOUSEHOLD_SYNC_REQUIRED');
        return privateJson(envelope(saved, after), 200, { ETag: '"' + after.revision + '"' });
    }
    finally {
        if (!uncertain)
            await repo.release(lock.token);
    }
}
function validateCommandImage(command: HouseholdCommand, _state: HouseholdState) {
    if (command.event.type === 'card.save' && command.event.card.imageFileId && !fileId(command.event.card.imageFileId))
        throw new PrivateError(400, 'INVALID_CARD_IMAGE');
}
async function verifyCardImage(api: HouseholdSheets, id: string, root: string, permissions: string[], cardId: string) {
    const m = await api.drive.metadata(id), p = await api.drive.permissions(id);
    if (m.trashed || m.parents?.length !== 1 || m.parents[0] !== root || m.appProperties?.cbhCard !== cardId || !['image/png', 'image/jpeg', 'image/webp'].includes(m.mimeType) || Number(m.size) > 5 * 1024 * 1024 || !p.length || p.some(x => x.type !== 'user' || !permissions.includes(x.id)))
        throw new PrivateError(403, 'INVALID_CARD_IMAGE');
    return m;
}
async function cardArt(request: Request, repo: HouseholdRepository, cardId: string, fetcher: typeof fetch) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(cardId))
        throw new PrivateError(400, 'INVALID_CARD_IMAGE');
    const row = await repo.row();
    if (!row?.spreadsheet_id || !row.state_hash)
        throw new PrivateError(409, 'HOUSEHOLD_SETUP_REQUIRED');
    const { api, permissions } = await workspaceApi(repo, row, fetcher);
    await api.privateBook(row.spreadsheet_id, row.root_id, permissions);
    if (request.method === 'GET') {
        const state = await checkedState(api, row), card = state.cards.find(c => c.id === cardId);
        if (!card?.imageFileId)
            throw new PrivateError(404, 'CARD_IMAGE_NOT_FOUND');
        const expectedImage = new URL(request.url).searchParams.get('image');
        if (expectedImage && expectedImage !== card.imageFileId)
            throw new PrivateError(409, 'CARD_IMAGE_CHANGED');
        const m = await verifyCardImage(api, card.imageFileId, row.root_id, permissions, cardId);
        const data = await readBounded(await api.drive.download(card.imageFileId), 5 * 1024 * 1024);
        if (!m.appProperties?.cbhImageHash || await digest(data) !== m.appProperties.cbhImageHash || m.sha256Checksum && m.sha256Checksum !== m.appProperties.cbhImageHash)
            throw new PrivateError(409, 'DRIVE_INTEGRITY_FAILED');
        await verifyCardImage(api, card.imageFileId, row.root_id, permissions, cardId);
        await repo.authorize();
        return new Response(data, { headers: { 'Content-Type': m.mimeType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' } });
    }
    if (request.method !== 'POST')
        throw new PrivateError(405, 'METHOD_NOT_ALLOWED');
    const operation = request.headers.get('X-CBH-Operation-ID') ?? '', mime = request.headers.get('Content-Type') ?? '';
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(operation) || !['image/png', 'image/jpeg', 'image/webp'].includes(mime))
        throw new PrivateError(400, 'INVALID_CARD_IMAGE');
    const state = await checkedState(api, row);
    const card = state.cards.find(c => c.id === cardId && !c.archived);
    if (!card)
        throw new PrivateError(404, 'HOUSEHOLD_CARD_NOT_FOUND');
    const bytes = await readBounded(request, 5 * 1024 * 1024);
    if (!bytes.byteLength || !validFilePrefix(bytes, mime))
        throw new PrivateError(400, 'INVALID_CARD_IMAGE');
    const checksum = await digest(bytes);
    type Upload = {
        operation_id: string;
        card_id: string;
        file_id: string;
        sha256: string;
        bytes: number;
        mime: string;
    };
    let upload = await repo.env.DB.prepare('SELECT * FROM household_card_uploads WHERE operation_id=?1').bind(operation).first<Upload>();
    if (!upload) {
        await repo.env.DB.prepare('DELETE FROM household_card_uploads WHERE completed_at<?1').bind(new Date(Date.now() - 30 * 86400000).toISOString()).run();
        const count = await repo.env.DB.prepare('SELECT COUNT(*) AS n FROM household_card_uploads').first<{
            n: number;
        }>();
        if ((count?.n ?? 0) >= 300)
            throw new PrivateError(409, 'CARD_IMAGE_UPLOAD_LIMIT');
        const id = await api.drive.generateId();
        await repo.authorize();
        await repo.env.DB.prepare('INSERT OR IGNORE INTO household_card_uploads(operation_id,card_id,file_id,sha256,bytes,mime,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)').bind(operation, cardId, id, checksum, bytes.byteLength, mime, clock()).run();
        upload = await repo.env.DB.prepare('SELECT * FROM household_card_uploads WHERE operation_id=?1').bind(operation).first<Upload>();
    }
    if (!upload || upload.card_id !== cardId || upload.sha256 !== checksum || upload.bytes !== bytes.byteLength || upload.mime !== mime)
        throw new PrivateError(409, 'HOUSEHOLD_COMMAND_REUSED');
    const id = upload.file_id;
    let exists = false;
    try {
        await api.drive.metadata(id);
        exists = true;
    }
    catch (error) {
        if (!(error instanceof PrivateError) || error.code !== 'DRIVE_FILE_MISSING')
            throw error;
    }
    if (!exists) {
        const boundary = 'cbh_' + crypto.randomUUID();
        const metadata = { id, name: '카드 이미지', mimeType: mime, parents: [row.root_id], appProperties: { cbhCard: cardId, cbhCardUpload: operation, cbhImageHash: checksum } };
        const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`, bytes, `\r\n--${boundary}--`]);
        await repo.authorize();
        try {
            await api.drive.request('upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
        }
        catch (error) {
            try {
                await verifyCardImage(api, id, row.root_id, permissions, cardId);
            }
            catch {
                throw error;
            }
        }
    }
    const m = await verifyCardImage(api, id, row.root_id, permissions, cardId);
    if (m.appProperties?.cbhImageHash !== checksum)
        throw new PrivateError(409, 'HOUSEHOLD_COMMAND_REUSED');
    await api.drive.verify({ id, bytes: bytes.byteLength, sha256: checksum, mime, folder: row.root_id, allowedPermissionIds: permissions });
    await repo.env.DB.prepare('UPDATE household_card_uploads SET completed_at=?2 WHERE operation_id=?1').bind(operation, clock()).run();
    return privateJson({ imageFileId: id });
}
export async function handleHousehold(request: Request, env: PrivateEnv, p: Principal, path: string[], fetcher: typeof fetch = fetch): Promise<Response> {
    const repo = new HouseholdRepository(env, p);
    await repo.authorize();
    try {
        if (path[0] === 'push-subscription')
            return handleHouseholdPushSubscription(request, env, p);
        if (path[0] === 'initialize' && request.method === 'POST')
            return await initialize(repo, fetcher);
        if (path[0] === 'events' && request.method === 'POST')
            return await commit(repo, parseHouseholdCommand(await readJson(request)), fetcher);
        if (path[0] === 'recover' && request.method === 'POST')
            return await commit(repo, null, fetcher);
        if (path[0] === 'cards' && path[2] === 'art' && path.length === 3)
            return cardArt(request, repo, path[1], fetcher);
        if (path.length === 0 && request.method === 'GET') {
            const row = await repo.row();
            let c;
            try {
                c = await repo.connected(row);
            }
            catch (error) {
                if (error instanceof PrivateError && error.code === 'DRIVE_FOLDER_REQUIRED')
                    return privateJson(envelope(row, null, false));
                throw error;
            }
            if (!row?.spreadsheet_id || !row.state_hash)
                return privateJson(envelope(row, null));
            // Verify live sharing/location before treating the private local copy as
            // fresh. A 304 skips ledger payload transfer, not permission validation.
            const api = new HouseholdSheets(await refreshDriveToken(c, env, fetcher), fetcher);
            await api.privateBook(row.spreadsheet_id, row.root_id, JSON.parse(c.permission_ids_json));
            if (!row.pending_id && request.headers.get('If-None-Match') === '"' + row.revision + '"') {
                await repo.authorize();
                return new Response(null, { status: 304, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie', ETag: '"' + row.revision + '"' } });
            }
            if (row.pending_id)
                throw new PrivateError(409, 'HOUSEHOLD_SYNC_REQUIRED');
            const state = await checkedState(api, row);
            await repo.authorize();
            return privateJson(envelope(row, state), 200, { ETag: '"' + row.revision + '"' });
        }
        throw new PrivateError(404, 'NOT_FOUND');
    }
    catch (error) {
        if (error instanceof HouseholdError)
            throw new PrivateError(error.code === 'INVALID_INPUT' ? 400 : 409, 'HOUSEHOLD_' + error.code);
        throw error;
    }
}
