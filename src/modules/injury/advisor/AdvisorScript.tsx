import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ApiError, privateRequest } from '../../auth/client';
import type { CaseRecord } from '../domain/records';
import type { CaseData } from '../ui/types';
import { scriptPayload } from './model';
import { saveAdvisorRecord } from './storage';
export function AdvisorScript({ data, reload, id, fallback, title = "말할 내용", recipient = "의사" }: {
    data: CaseData;
    reload: () => Promise<void>;
    id: string; fallback: string; title?: string; recipient?: string;
}) {
    const record = data.records.find(r => r.id === id && !r.archivedAt);
    const text = record?.payload.body ?? fallback;
    const [editing, setEditing] = useState(false), [draft, setDraft] = useState(text), [base, setBase] = useState(record);
    const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [conflict, setConflict] = useState<CaseRecord | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null), point = useRef({ x: 0, y: 0 });
    const cancel = () => { if (timer.current)
        clearTimeout(timer.current); timer.current = null; };
    useEffect(() => cancel, []);
    const edit = () => { setDraft(text); setBase(record); setEditing(true); setMessage(""); setConflict(null); };
    const down = (e: PointerEvent) => { if (editing || (e.target as HTMLElement).closest("button,input,textarea,a"))
        return; point.current = { x: e.clientX, y: e.clientY }; cancel(); timer.current = setTimeout(edit, 550); };
    const save = async () => { if (busy)
        return; setBusy(true); setMessage(""); try {
        await saveAdvisorRecord(id, base?.revision ?? 0, { ...scriptPayload(draft), title, data: { category: "message", medium: "spoken", recipient } });
        await reload();
        setEditing(false);
        setMessage("문장을 저장했어요.");
    }
    catch (e) {
        if (e instanceof ApiError && e.code === "REVISION_CONFLICT") {
            const latest = await privateRequest<{
                record: CaseRecord;
            }>("private/case/records/" + id).catch(() => null);
            setConflict(latest?.record ?? null);
        }
        setMessage("저장하지 못했어요. 작성한 내용은 그대로예요. 다시 저장해 주세요.");
    }
    finally {
        setBusy(false);
    } };
    return <article className="private-card advisor-script" onPointerDown={down} onPointerMove={e => { if (Math.hypot(e.clientX - point.current.x, e.clientY - point.current.y) > 8)
        cancel(); }} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}>
    <h3>{title}</h3>
    <div className="advisor-copy-bar"><button className="secondary" onClick={async () => { try {
        await navigator.clipboard.writeText(editing ? draft : text);
        setMessage("복사했어요. 문자나 메신저에 붙여 넣어 주세요.");
    }
    catch {
        setMessage("복사하지 못했어요. 아래 문장을 길게 눌러 직접 선택할 수 있어요.");
    } }}>문장 복사</button>{!editing && <button className="secondary" onClick={edit}>문장 편집</button>}</div>
    {editing ? <><label htmlFor="advisor-delivery-text">전달할 문장</label><textarea id="advisor-delivery-text" value={draft} maxLength={60000} rows={9} onChange={e => setDraft(e.target.value)}/><div className="private-actions"><button disabled={busy || !!conflict || !draft.trim()} onClick={() => void save()}>문장 저장</button><button className="secondary" disabled={busy} onClick={() => { setEditing(false); setDraft(text); setConflict(null); setMessage("편집을 취소했어요."); }}>취소</button></div></> : <p className="advisor-script-body">{text}</p>}
    {conflict && <div className="conflict-panel"><h4>다른 기기의 최신 문장</h4><p className="advisor-script-body">{conflict.payload.body}</p><button className="secondary" onClick={() => { setBase(conflict); setConflict(null); }}>내 문장 유지</button></div>}
    <p role="status">{message}</p><small>{record ? "수정 이력은 내 관리함에서 볼 수 있어요" : "내 상황에 맞게 고쳐서 쓰세요."}</small>
  </article>;
}
