import { PrivateError, readBounded } from '../auth/contracts';
import { DriveArchive, type DriveMetadata } from '../documents/drive';
import type { HouseholdState, HouseholdCommand } from '../../../src/modules/household/domain/model';
export const HOUSEHOLD_SCHEMA = 'cbh-household/v1';
const MAX_ROWS = 50000;
const MAX_RESPONSE = 16 * 1024 * 1024;
const TABS = [['_state', 100], ['카드', 101], ['장부', 102], ['월급 계획', 103], ['할 일', 104], ['수정 이력', 105], ['요약', 106], ['일별', 107], ['주별', 108], ['월별', 109], ['연별', 110]] as const;
type Cell = {
    userEnteredValue: {
        stringValue?: string;
        numberValue?: number;
        boolValue?: boolean;
        formulaValue?: string;
    };
};
const text = (v: unknown): Cell => ({ userEnteredValue: typeof v === 'number' ? { numberValue: v } : typeof v === 'boolean' ? { boolValue: v } : { stringValue: String(v ?? '') } });
const formula = (v: string): Cell => ({ userEnteredValue: { formulaValue: v } });
export function cells(values: unknown[]) { return values.map(text); }
const row = (sheetId: number, index: number, values: unknown[]) => ({ updateCells: { range: { sheetId, startRowIndex: index, endRowIndex: index + 1, startColumnIndex: 0, endColumnIndex: values.length }, rows: [{ values: cells(values) }], fields: 'userEnteredValue' } });
/** Private app-created workbook. Values supplied by users always use stringValue,
 * never USER_ENTERED/formula interpretation. Only versioned built-in summary
 * formulas use formulaValue. The JSON column is the authoritative machine view. */
export class HouseholdSheets {
    readonly drive: DriveArchive;
    constructor(private token: string, private fetcher: typeof fetch = fetch) { this.drive = new DriveArchive(token, fetcher); }
    async request(path: string, init: RequestInit = {}) {
        const fetcher = this.fetcher;
        const response = await fetcher('https://sheets.googleapis.com/v4/spreadsheets/' + path, { ...init, headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json', ...init.headers }, signal: AbortSignal.timeout(25000), redirect: 'manual' });
        if (!response.ok) {
            if (response.status === 403)
                throw new PrivateError(503, 'HOUSEHOLD_SHEETS_ACCESS_REQUIRED');
            if (response.status === 401)
                throw new PrivateError(401, 'DRIVE_RECONNECT');
            if (response.status === 429)
                throw new PrivateError(503, 'HOUSEHOLD_TRY_LATER');
            throw new PrivateError(502, 'HOUSEHOLD_SHEETS_FAILED');
        }
        return JSON.parse(new TextDecoder().decode(await readBounded(response, MAX_RESPONSE))) as Record<string, any>;
    }
    async privateBook(id: string, root: string, permissions: string[]) {
        const [m, p] = await Promise.all([this.drive.metadata(id), this.drive.permissions(id)]);
        if (m.trashed || m.mimeType !== 'application/vnd.google-apps.spreadsheet' || m.parents?.length !== 1 || m.parents[0] !== root || m.appProperties?.cbhHousehold !== HOUSEHOLD_SCHEMA)
            throw new PrivateError(409, 'HOUSEHOLD_BOOK_MOVED');
        if (!p.length || p.some(x => x.type !== 'user' || !permissions.includes(x.id)))
            throw new PrivateError(403, 'DRIVE_NOT_PRIVATE');
        return m;
    }
    async locate(root: string, marker: string): Promise<string | null> {
        // IDs and UUIDs are validated at their trusted DB/API boundaries.
        const q = `'${root}' in parents and trashed=false and appProperties has { key='cbhHouseholdInit' and value='${marker}' }`;
        const result = await (await this.drive.request('drive/v3/files?' + new URLSearchParams({ q, fields: 'files(id),nextPageToken', pageSize: '10' }))).json() as {
            files?: Array<{
                id: string;
            }>;
            nextPageToken?: string;
        };
        if (result.nextPageToken || (result.files?.length ?? 0) > 1)
            throw new PrivateError(409, 'HOUSEHOLD_DUPLICATE_BOOK');
        return result.files?.[0]?.id ?? null;
    }
    async create(root: string, marker: string): Promise<string> {
        // Native Sheets cannot use pre-generated IDs. A durable initialization
        // marker is searched before retries; ambiguous create errors are retained.
        const result = await (await this.drive.request('drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '우리집 가계부', mimeType: 'application/vnd.google-apps.spreadsheet', parents: [root], appProperties: { cbhHousehold: HOUSEHOLD_SCHEMA, cbhHouseholdInit: marker } }) })).json() as {
            id?: string;
        };
        if (!result.id)
            throw new PrivateError(502, 'HOUSEHOLD_SHEETS_FAILED');
        return result.id;
    }
    async initialize(id: string, state: HouseholdState) {
        const book = await this.request(encodeURIComponent(id) + '?fields=sheets.properties');
        const existing = (book.sheets ?? []).map((s: any) => s.properties) as Array<{
            sheetId: number;
            title: string;
        }>;
        const requests: unknown[] = [{ updateSpreadsheetProperties: { properties: { locale: 'ko_KR', timeZone: 'Asia/Seoul' }, fields: 'locale,timeZone' } }];
        for (const [title, sheetId] of TABS) {
            const same = existing.find(s => s.sheetId === sheetId);
            if (same && same.title !== title)
                throw new PrivateError(409, 'HOUSEHOLD_SCHEMA_CHANGED');
            if (!same)
                requests.push({ addSheet: { properties: { sheetId, title, hidden: title === '_state', ...(sheetId === 106 ? { index: 0 } : {}), gridProperties: { rowCount: sheetId === 100 ? 2 : sheetId === 106 ? 30 : MAX_ROWS + 1, columnCount: sheetId === 102 ? 16 : sheetId === 106 ? 3 : 8, frozenRowCount: 1 } } } });
        }
        // Keep any default blank sheet: never delete a user's sheet as setup cleanup.
        requests.push(row(100, 0, ['schema', 'revision', 'lastCommandId', 'preferences']), row(100, 1, [HOUSEHOLD_SCHEMA, state.revision, state.lastCommandId ?? '', JSON.stringify({ preferences: state.preferences, lastCommandPayload: state.lastCommandPayload })]));
        const headers: Record<number, string[]> = { 101: ['ID', '데이터', '카드 이름', '종류', '설정 한도', '시작 잔액', '방향', '보관'], 102: ['ID', '데이터', '기록 시각', '종류', '금액', '가게', '분류', '세부 분류', '메모', '카드', '취소', '월', '일', '주', '연', '대출로 마련한 금액'], 103: ['ID', '데이터', '월', '계획 수입', '배분 합계'], 104: ['ID', '데이터', '할 일', '완료', '알림 시각'], 105: ['명령 ID', '명령 해시', '작성자', '변경 시각', '종류', '변경 전 버전'] };
        for (const [sheetId, head] of Object.entries(headers))
            requests.push(row(Number(sheetId), 0, head));
        requests.push(row(106, 0, ['우리집 가계부']), row(106, 2, ['입력과 수정', 'ComeBackHome의 가계부에서 두 사람이 함께 입력해요.']), row(106, 4, ['장부', '쓴 돈·받은 돈과 상환·대출·이체를 구분해 보관해요.']), row(106, 6, ['기간별 요약', '일별·주별·월별·연별 탭에서 합계를 확인하세요.']), row(106, 8, ['기록 보존', '잘못 입력한 내역도 수정 이력에 남아요.']), row(106, 10, ['시트 편집', '앱과 금액이 어긋나지 않도록 입력은 앱에서 해주세요.']), ...summaryQueries());
        for (const sheetId of [101, 102, 103, 104])
            requests.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 2 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } });
        await this.request(encodeURIComponent(id) + ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) });
    }
    async read(id: string): Promise<HouseholdState> {
        const ranges = ["'_state'!A2:D2", "'카드'!A2:H50001", "'장부'!A2:P50001", "'월급 계획'!A2:E50001", "'할 일'!A2:E50001"];
        const qs = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE' });
        for (const r of ranges)
            qs.append('ranges', r);
        const result = await this.request(encodeURIComponent(id) + '/values:batchGet?' + qs);
        const values = (result.valueRanges ?? []).map((v: any) => v.values ?? []);
        const meta = values[0]?.[0];
        if (meta?.[0] !== HOUSEHOLD_SCHEMA || !Number.isSafeInteger(meta[1]) || meta[1] < 0)
            throw new PrivateError(409, 'HOUSEHOLD_SCHEMA_CHANGED');
        const parseRows = (key: string, rows: any[]) => rows.map(r => { if (!r[0] || typeof r[1] !== 'string')
            throw new PrivateError(409, 'HOUSEHOLD_SHEET_EDITED'); const v = JSON.parse(r[1]); if (v.id !== r[0])
            throw new PrivateError(409, 'HOUSEHOLD_SHEET_EDITED'); const projected = entityValues(key, v); if (projected.some((cell, i) => i > 1 && (r[i] ?? '') !== cell))
            throw new PrivateError(409, 'HOUSEHOLD_SHEET_EDITED'); return v; });
        try {
            return { schemaVersion: 1, revision: meta[1], lastCommandId: meta[2] || null, preferences: JSON.parse(meta[3]).preferences, lastCommandPayload: JSON.parse(meta[3]).lastCommandPayload ?? null, cards: parseRows('cards', values[1]), entries: parseRows('entries', values[2]), plans: parseRows('plans', values[3]), todos: parseRows('todos', values[4]) };
        }
        catch (error) {
            if (error instanceof PrivateError)
                throw error;
            throw new PrivateError(409, 'HOUSEHOLD_SHEET_EDITED');
        }
    }
    async history(id: string, revision: number): Promise<{
        id: string;
        hash: string;
    } | null> {
        if (revision < 0 || revision >= MAX_ROWS)
            return null;
        const result = await this.request(encodeURIComponent(id) + '/values/' + encodeURIComponent(`'수정 이력'!A${revision + 2}:B${revision + 2}`));
        return result.values?.[0]?.[0] ? { id: result.values[0][0], hash: result.values[0][1] } : null;
    }
    async commandExists(id: string, commandId: string): Promise<boolean> {
        const result = await this.request(encodeURIComponent(id) + '/values/' + encodeURIComponent("'수정 이력'!A2:A50001"));
        return (result.values ?? []).some((r: unknown[]) => r[0] === commandId);
    }
    async commit(id: string, before: HouseholdState, after: HouseholdState, command: HouseholdCommand, hash: string, actor: string, at: string) {
        if (after.revision > MAX_ROWS)
            throw new PrivateError(409, 'HOUSEHOLD_ARCHIVE_REQUIRED');
        const requests: unknown[] = [];
        const groups = [['cards', 101], ['entries', 102], ['plans', 103], ['todos', 104]] as const;
        for (const [key, sheet] of groups) {
            const previous = before[key] as Array<{
                id: string;
            }>;
            const next = after[key] as Array<{
                id: string;
            }>;
            if (next.length > MAX_ROWS || next.length < previous.length)
                throw new PrivateError(409, 'HOUSEHOLD_ARCHIVE_REQUIRED');
            for (let index = 0; index < next.length; index++) {
                if (previous[index] && previous[index].id !== next[index].id)
                    throw new PrivateError(409, 'HOUSEHOLD_ORDER_CHANGED');
                if (JSON.stringify(previous[index]) !== JSON.stringify(next[index]))
                    requests.push(row(sheet, index + 1, entityValues(key, next[index])));
            }
        }
        requests.push(row(100, 1, [HOUSEHOLD_SCHEMA, after.revision, after.lastCommandId ?? '', JSON.stringify({ preferences: after.preferences, lastCommandPayload: after.lastCommandPayload })]), row(105, before.revision + 1, [command.id, hash, actor, at, command.event.type, before.revision]));
        // One atomic Sheets batch: financial effect, audit receipt and revision
        // become visible together. A lost response is reconciled by this receipt.
        await this.request(encodeURIComponent(id) + ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) });
    }
}
function entityValues(key: string, value: any): unknown[] {
    const head = [value.id, JSON.stringify(value)];
    if (key === 'cards')
        return [...head, value.name, value.kind, value.limit, value.openingRemaining, value.orientation, !!value.archived];
    if (key === 'plans')
        return [...head, value.month, value.plannedIncome, value.allocations.reduce((sum: number, a: {
                amount: number;
            }) => sum + a.amount, 0)];
    if (key === 'todos')
        return [...head, value.text, !!value.completedAt, value.dueAt ?? ''];
    const date = new Date(value.occurredAt), kst = new Date(date.getTime() + 9 * 3600000), day = kst.toISOString().slice(0, 10), monday = new Date(kst);
    monday.setUTCDate(kst.getUTCDate() - (kst.getUTCDay() + 6) % 7);
    return [...head, value.occurredAt, value.kind, value.amount, value.merchant ?? '', value.category ?? '', value.subcategory ?? '', value.note ?? '', value.cardId ?? '', !!value.voidedAt, day.slice(0, 7), day, monday.toISOString().slice(0, 10), day.slice(0, 4), value.kind === 'borrowing' || value.kind === 'repayment' && value.repaymentSourceCardId ? value.amount : 0];
}
function summaryQueries(): unknown[] {
    return [[107, 'M', '일'], [108, 'N', '주 시작일'], [109, 'L', '월'], [110, 'O', '연']].flatMap(([sheetId, field, label]) => [
        row(Number(sheetId), 0, [label, '지출', '환불', '순지출', '수입', '상환', '대출', '이체']),
        { updateCells: { range: { sheetId: Number(sheetId), startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 1 }, rows: [{ values: [formula(`=IF(COUNTA(장부!A2:A)=0,"",QUERY({장부!${field}2:${field},ARRAYFORMULA(IF((장부!D2:D="expense")*(장부!K2:K=FALSE),장부!E2:E,0)),ARRAYFORMULA(IF((장부!D2:D="refund")*(장부!K2:K=FALSE),장부!E2:E,0)),ARRAYFORMULA(IF((장부!D2:D="expense")*(장부!K2:K=FALSE),장부!E2:E,IF((장부!D2:D="refund")*(장부!K2:K=FALSE),-장부!E2:E,0))),ARRAYFORMULA(IF((장부!D2:D="income")*(장부!K2:K=FALSE),장부!E2:E,0)),ARRAYFORMULA(IF((장부!D2:D="repayment")*(장부!K2:K=FALSE),장부!E2:E,0)),ARRAYFORMULA(IF(장부!K2:K=FALSE,장부!P2:P,0)),ARRAYFORMULA(IF((장부!D2:D="transfer")*(장부!K2:K=FALSE),장부!E2:E,0))},"select Col1,sum(Col2),sum(Col3),sum(Col4),sum(Col5),sum(Col6),sum(Col7),sum(Col8) where Col1 is not null group by Col1 label Col1 '',sum(Col2) '',sum(Col3) '',sum(Col4) '',sum(Col5) '',sum(Col6) '',sum(Col7) '',sum(Col8) ''",0))`)] }], fields: 'userEnteredValue' } },
    ]);
}
