import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthRoot';
import { ApiError } from '../auth/client';
import type { HouseholdState, HouseholdCommand } from './domain/model';
import { readCache, writeCache, clearHouseholdCache } from './cache';
export { clearHouseholdCache, householdCacheEnabled, setHouseholdCacheEnabled } from './cache';

export interface HouseholdResponse {
  ready: boolean;
  connected: boolean;
  snapshot: HouseholdState | null;
  revision: number;
  pending?: boolean;
  spreadsheetUrl: string | null;
}
const errors: Record<string, string> = {
  HOUSEHOLD_NOT_READY: '먼저 가계부를 만들어 주세요.',
  HOUSEHOLD_REVISION_CONFLICT: '다른 기기에서 먼저 수정했어요. 최신 내용과 입력을 확인한 뒤 다시 저장해 주세요.',
  HOUSEHOLD_BUSY: '다른 기록을 저장하고 있어요. 잠시 후 다시 눌러 주세요.',
  HOUSEHOLD_WRITE_PENDING: '저장 결과를 확인 중이에요. 같은 화면에서 다시 저장을 누르면 중복 없이 확인해요.',
  HOUSEHOLD_DRIVE_UNAVAILABLE: 'Drive에 연결하지 못했어요. 입력은 그대로 두고 다시 시도해 주세요.',
  SHEETS_API_DISABLED: 'Google Cloud에서 Google Sheets API를 켜야 해요. 설정 안내를 확인해 주세요.',
  SHEETS_ACCESS_REQUIRED: '연결에 사용한 Google Cloud 프로젝트에서 Google Sheets API를 켜 주세요. Drive 연결을 새로 만들 필요는 없어요.',
  HOUSEHOLD_SYNC_REQUIRED: '앞서 저장한 결과를 확인해야 해요. 아래 ‘저장 결과 확인’을 눌러 주세요.',
  HOUSEHOLD_INVALID_INPUT: '금액과 입력 내용을 확인해 주세요.',
  HOUSEHOLD_INVALID_CARD_OPERATION: '이 카드에서 사용할 수 없는 거래예요. 카드 종류와 기록 구분을 확인해 주세요.',
  HOUSEHOLD_INVALID_COMMAND: '금액과 입력 내용을 확인해 주세요.',
  HOUSEHOLD_INSUFFICIENT_CAPACITY: '남은 금액보다 커요. 금액을 확인하거나 먼저 상환 내역을 기록해 주세요.',
  HOUSEHOLD_INVALID_IMAGE: '카드 사진은 5MB 이하의 JPG·PNG·WebP로 올려 주세요.',
  HOUSEHOLD_SHEETS_ACCESS_REQUIRED: '연결에 사용한 Google Cloud 프로젝트에서 Google Sheets API를 켜 주세요. Drive 연결을 새로 만들 필요는 없어요.',
  HOUSEHOLD_SHEETS_FAILED: 'Drive 장부를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
  HOUSEHOLD_TRY_LATER: 'Drive 요청이 잠시 몰렸어요. 조금 뒤 다시 눌러 주세요.',
  HOUSEHOLD_BOOK_MOVED: '장부 위치가 바뀌었어요. 처음 연결한 비공개 폴더로 되돌린 뒤 다시 확인해 주세요.',
  HOUSEHOLD_ROOT_CHANGED: '연결한 보관 폴더가 바뀌었어요. 기존 가계부의 폴더를 다시 연결해 주세요.',
  HOUSEHOLD_SHEET_EDITED: '시트에서 원본 기록이 바뀌어 저장을 멈췄어요. 버전 기록에서 변경 전으로 되돌린 뒤 확인해 주세요.',
  HOUSEHOLD_SCHEMA_CHANGED: '장부의 열이나 시트 이름이 바뀌었어요. 원래 구조를 복원한 뒤 다시 확인해 주세요.',
  HOUSEHOLD_ARCHIVE_REQUIRED: '장부 보관 한도에 가까워졌어요. 기존 기록을 보존한 채 기간별 장부로 나누는 작업이 필요해요.',
  HOUSEHOLD_CARD_IN_USE: '사용 기록이 있는 카드의 시작 금액과 종류는 바꿀 수 없어요. 상환·충전 내역을 기록해 주세요.',
  HOUSEHOLD_TODO_ARCHIVED: '삭제한 메모예요. 목록을 새로 불러와 주세요.',
  HOUSEHOLD_TODO_NOT_COMPLETED: '완료한 항목만 삭제할 수 있어요.',
  HOUSEHOLD_CARD_ARCHIVED: '보관한 카드예요. 사용 중인 카드를 선택해 주세요.',
  HOUSEHOLD_ACCESS_DENIED: '이 계정에서 가계부를 사용할 수 없어요.',
  HOUSEHOLD_COMMAND_REUSED: '이전에 저장한 요청과 내용이 달라요. 최신 내용을 확인한 뒤 다시 입력해 주세요.',
  HOUSEHOLD_SETUP_REQUIRED: '가계부를 먼저 만들어 주세요.',
  HOUSEHOLD_DUPLICATE_ID: '이미 저장한 기록이에요. 화면을 닫고 목록에서 확인해 주세요.',
  HOUSEHOLD_NOTHING_TO_RECOVER: '확인할 대기 내역이 없어요. 최신 내용을 다시 불러와 주세요.',
  INVALID_CARD_IMAGE: '카드 사진은 5MB 이하의 JPG·PNG·WebP로 올려 주세요.',
};
export function householdError(error: unknown) {
  if (error instanceof ApiError) return errors[error.code] ?? error.message;
  return error instanceof TypeError ? '인터넷 연결을 확인해 주세요. 저장을 눌렀다면 같은 화면에서 다시 눌러 결과를 확인할 수 있어요.' : error instanceof Error ? error.message : '처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
}
async function request<T = HouseholdResponse>(path: string, init: RequestInit = {}, cached?: T): Promise<T> {
  const response = await fetch('/api/private/household' + path, { ...init, credentials: 'same-origin', cache: 'no-store' });
  if (response.status === 304 && cached) return cached;
  const data = await response.json().catch(() => ({ error: 'PRIVATE_SERVICE_UNAVAILABLE' }));
  if (!response.ok) {
    throw new ApiError(data.error ?? 'PRIVATE_SERVICE_UNAVAILABLE', response.status);
  }
  return data as T;
}

export function useHousehold() {
  const { user } = useAuth();
  const [data, setData] = useState<HouseholdResponse | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [stale, setStale] = useState(false), [error, setError] = useState(''), [needsRecovery, setNeedsRecovery] = useState(false);
  const current = useRef<HouseholdResponse | null>(null), identity = useRef<string | null>(null), generation = useRef(0), lock = useRef(false), identityEpoch = useRef(0), operationToken = useRef(0), activeOperation = useRef<AbortController | null>(null);
  const setupError = useRef('');
  const pending = useRef<{ fingerprint: string; command: HouseholdCommand } | null>(null);
  const pendingArt = useRef<{ cardId: string; hash: string; operationId: string; imageFileId?: string; command?: HouseholdCommand } | null>(null);
  const accept = useCallback((value: HouseholdResponse, userId: string) => {
    if (identity.current !== userId) return;
    // A successful status read may still say 'not created'. It does not resolve
    // a Sheets setup failure from the user's initialization attempt.
    if (value.ready) setupError.current = '';
    current.current = value; setData(value); setStale(false); setLoading(false); setError(setupError.current); setNeedsRecovery(Boolean(value.pending)); writeCache(userId, value);
  }, []);
  const reload = useCallback(async () => {
    const userId = identity.current;
    if (!userId || lock.current) return;
    const epoch = identityEpoch.current;
    const serial = ++generation.current;
    const cached = current.current;
    try {
      const value = await request('', { headers: cached?.ready ? { 'If-None-Match': '"' + cached.revision + '"' } : {} }, cached ?? undefined);
      if (serial === generation.current && epoch === identityEpoch.current) accept(value, userId);
    } catch (err) {
      if (serial === generation.current && epoch === identityEpoch.current && identity.current === userId) {
        if (err instanceof ApiError && err.code === 'HOUSEHOLD_SYNC_REQUIRED') setNeedsRecovery(true);
        if (err instanceof ApiError && [401,403].includes(err.status)) { setupError.current = ''; clearHouseholdCache(); current.current = null; setData(null); }
        if (err instanceof ApiError && err.code === 'LOGIN_REQUIRED') window.dispatchEvent(new Event('cbh-auth-expired'));
        setError(setupError.current || householdError(err)); setStale(Boolean(current.current?.snapshot)); setLoading(false);
      }
    }
  }, [accept]);
  useEffect(() => {
    generation.current++; identityEpoch.current++; operationToken.current++; activeOperation.current?.abort(); lock.current = false; setBusy(false); pending.current = null; pendingArt.current = null; identity.current = user?.id ?? null;
    current.current = null; setupError.current = ''; setData(null); setError(''); setStale(false); setNeedsRecovery(false); setLoading(Boolean(user));
    if (!user) { clearHouseholdCache(); return; }
    // Authentication has already been checked by AuthRoot before any private cache is shown.
    const cached = readCache(user.id);
    if (cached) { current.current = cached.value; setData(cached.value); setLoading(false); setStale(true); }
    void reload();
    const refresh = () => { if (document.visibilityState === 'visible' && !lock.current) void reload(); };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('online', refresh); window.addEventListener('focus', refresh);
    return () => { generation.current++; identityEpoch.current++; activeOperation.current?.abort(); identity.current = null; current.current = null; window.clearInterval(timer); window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh); };
  }, [user?.id, reload]);
  const operation = async (run: (signal: AbortSignal) => Promise<HouseholdResponse>, initializing = false) => {
    const userId = identity.current;
    if (!userId || lock.current) return false;
    const epoch = identityEpoch.current, token = ++operationToken.current, abort = new AbortController();
    const isCurrent = () => epoch === identityEpoch.current && token === operationToken.current && identity.current === userId;
    generation.current++; activeOperation.current = abort; lock.current = true; setupError.current = ''; setBusy(true); setError('');
    try { const value = await run(abort.signal); if (!isCurrent()) return false; accept(value, userId); return true; }
    catch (err) {
      if (!isCurrent()) return false;
      if (err instanceof ApiError && /REVISION_CONFLICT/.test(err.code)) { pending.current = null; if (pendingArt.current) pendingArt.current.command = undefined; lock.current = false; await reload(); }
      if (err instanceof ApiError && err.code === 'HOUSEHOLD_SYNC_REQUIRED') { setNeedsRecovery(true); setStale(true); }
      if (err instanceof ApiError && [401,403].includes(err.status)) { clearHouseholdCache(); current.current = null; setData(null); }
      if (err instanceof ApiError && err.code === 'LOGIN_REQUIRED') window.dispatchEvent(new Event('cbh-auth-expired'));
      if (isCurrent()) {
        const message = householdError(err);
        if (initializing && err instanceof ApiError && ['SHEETS_API_DISABLED', 'SHEETS_ACCESS_REQUIRED', 'HOUSEHOLD_SHEETS_ACCESS_REQUIRED'].includes(err.code)) setupError.current = message;
        setError(message);
      }
      return false;
    } finally { if (isCurrent()) { lock.current = false; activeOperation.current = null; setBusy(false); } }
  };
  const mutate = async (event: HouseholdCommand['event']) => operation(async signal => {
    if (!current.current?.snapshot || stale) throw new Error('최신 내용을 불러온 뒤 저장할 수 있어요.');
    const fingerprint = JSON.stringify(event);
    if (!pending.current || pending.current.fingerprint !== fingerprint) pending.current = { fingerprint, command: { id: crypto.randomUUID(), expectedRevision: current.current.revision, event } };
    const value = await request('/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending.current.command), signal });
    signal.throwIfAborted();
    pending.current = null;
    return value;
  });
  const initialize = () => operation(signal => request('/initialize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal }), true);
  const recover = () => operation(async signal => { const value = await request('/recover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal }); signal.throwIfAborted(); pending.current = null; return value; });
  const uploadArt = (cardId: string, file: File) => operation(async signal => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error(errors.HOUSEHOLD_INVALID_IMAGE);
    const card = current.current?.snapshot?.cards.find(item => item.id === cardId);
    if (!card || stale) throw new Error('최신 내용을 불러온 뒤 사진을 올려 주세요.');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), value => value.toString(16).padStart(2, '0')).join('');
    signal.throwIfAborted();
    if (!pendingArt.current || pendingArt.current.hash !== hash || pendingArt.current.cardId !== cardId) pendingArt.current = { cardId, hash, operationId: crypto.randomUUID() };
    const upload = pendingArt.current;
    if (!upload.imageFileId) {
      const result = await request<{ imageFileId: string }>('/cards/' + encodeURIComponent(cardId) + '/art', { method: 'POST', headers: { 'Content-Type': file.type, 'X-CBH-Operation-ID': upload.operationId }, body: file, signal });
      signal.throwIfAborted();
      upload.imageFileId = result.imageFileId;
    }
    upload.command ??= { id: crypto.randomUUID(), expectedRevision: current.current!.revision, event: { type: 'card.save', card: { id: card.id, name: card.name, kind: card.kind, balanceMode: card.balanceMode, limit: card.limit, openingRemaining: card.openingRemaining, orientation: card.orientation, archived: card.archived, imageFileId: upload.imageFileId } } };
    const result = await request('/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(upload.command), signal });
    signal.throwIfAborted();
    pendingArt.current = null;
    return result;
  });
  return { data, loading, busy, stale, error, needsRecovery, reload, mutate, initialize, recover, uploadArt, clearError: () => { setupError.current = ''; setError(''); } };
}
export type HouseholdController = ReturnType<typeof useHousehold>;
