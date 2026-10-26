import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ApiError, privateRequest } from "../../auth/client";
import type { CaseRecord } from "../domain/records";
import type { CaseData } from "../ui/types";
import { advisorSummary, answerText, emptyProfile, HOSPITAL_SCRIPT, profileId, profilePayload, QUESTIONS, readProfile, scriptId, scriptPayload, type AdvisorProfile } from "./model";
import "./advisor.css";
type Route = "today" | "progress" | "library" | "manage" | "help";
type Props = {
    data: CaseData;
    reload: () => Promise<void>;
    navigate: (route: Route) => void;
};
const saveRecord = async (id: string, revision: number, payload: ReturnType<typeof profilePayload>) => (await privateRequest<{
    record: CaseRecord;
}>("private/case/records/" + id, "PUT", { kind: "content", revision, payload })).record;
export function AdvisorHome({ data, reload, navigate }: Props) {
    const stored = data.records.find(r => r.id === profileId(data.caseId));
    const [base, setBase] = useState(stored), [draft, setDraft] = useState(readProfile(stored) ?? emptyProfile());
    const [view, setView] = useState<"home" | "hospital" | "questions">(() => new URLSearchParams(location.search).get("action") === "hospital" ? "hospital" : "home");
    const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [conflict, setConflict] = useState<CaseRecord | null>(null);
    const latch = useRef(false);
    useEffect(() => { if (view !== "questions") {
        setBase(stored);
        setDraft(readProfile(stored) ?? emptyProfile());
    } }, [stored, view]);
    const summary = advisorSummary(data.records, readProfile(stored));
    const open = (next: typeof view) => { setView(next); setMessage(""); history.replaceState(null, "", "/injury?section=today" + (next === "hospital" ? "&action=hospital" : "")); window.scrollTo(0, 0); };
    const begin = (cursor?: number) => {
        if (stored && (!readProfile(stored) || stored.archivedAt)) {
            setMessage("저장한 답변을 지금 열 수 없어요. 기존 답변은 바꾸지 않았어요. 오늘의 안내는 계속 볼 수 있어요.");
            return;
        }
        setBase(stored);
        setDraft({ ...(readProfile(stored) ?? emptyProfile()), ...(cursor !== undefined ? { cursor } : {}), confirmed: false });
        setConflict(null);
        open("questions");
    };
    const persist = async (next: AdvisorProfile, close = false) => {
        if (latch.current)
            return;
        latch.current = true;
        setBusy(true);
        setMessage("");
        setDraft(next);
        try {
            const record = await saveRecord(profileId(data.caseId), base?.revision ?? 0, profilePayload(next));
            setBase(record);
            setConflict(null);
            await reload();
            if (close)
                open("home");
        }
        catch (error) {
            if (error instanceof ApiError && error.code === "REVISION_CONFLICT") {
                const latest = await privateRequest<{
                    record: CaseRecord;
                }>("private/case/records/" + profileId(data.caseId)).catch(() => null);
                setConflict(latest?.record ?? null);
                setMessage("다른 기기에서 먼저 답변을 바꿨어요. 내 선택은 남아 있어요. 최신 답변을 확인한 뒤 다시 저장해 주세요.");
            }
            else
                setMessage("답변을 저장하지 못했어요. 내 선택은 화면에 남아 있어요. 연결을 확인한 뒤 다시 저장해 주세요.");
        }
        finally {
            latch.current = false;
            setBusy(false);
        }
    };
    if (view === "questions")
        return <section className="advisor-stack" aria-label="내 상황 확인">
    <button className="secondary advisor-back" disabled={busy} onClick={() => open("home")}>← 오늘로 돌아가기</button>
    <article className="private-card advisor-question">
      <span className="advisor-eyebrow">내 상황 확인 {Math.min(draft.cursor + 1, 3)} / 3</span>
      <h2>{draft.cursor < 3 ? QUESTIONS[draft.cursor].title : "확인한 내용이 맞나요?"}</h2>
      <p>정확히 몰라도 괜찮아요. 알려주신 내용은 나중에 바꿀 수 있어요.</p>
      {draft.cursor < 3 ? <div className="advisor-choices">
        {QUESTIONS[draft.cursor].options.map(([value, title]) => <button className="secondary" disabled={busy || !!conflict} key={value} onClick={() => { const answers = [...draft.answers]; answers[draft.cursor] = value; void persist({ ...draft, answers, cursor: draft.cursor + 1, confirmed: false, deferred: false }); }}>{title}</button>)}
        <button className="secondary" disabled={busy || !!conflict} onClick={() => { const answers = [...draft.answers]; answers[draft.cursor] = null; void persist({ ...draft, answers, cursor: draft.cursor + 1, confirmed: false }); }}>잘 모르겠어요</button>
      </div> : <><AnswerSummary profile={draft}/><p className="advisor-note">직접 알려주신 내용으로 보관해요. 진단이나 산재 승인, 지급 결정으로 바뀌지는 않아요.</p><button disabled={busy || !!conflict} onClick={() => void persist({ ...draft, confirmed: true, deferred: false }, true)}>맞아요 · 답변 저장</button><button className="secondary" disabled={busy} onClick={() => setDraft({ ...draft, cursor: 0, confirmed: false })}>수정할래요</button></>}
      <button className="secondary advisor-later" disabled={busy || !!conflict} onClick={() => void persist({ ...draft, deferred: true }, true)}>지금은 나중에 할래요</button>
      {message && <p role="alert">{message}</p>}
      {conflict && <div className="conflict-panel"><h3>다른 기기의 최신 답변</h3><AnswerSummary profile={readProfile(conflict)}/><button className="secondary" disabled={busy} onClick={() => { setBase(conflict); setConflict(null); setMessage("최신 답변을 확인했어요. 내 선택을 저장하려면 아래 버튼을 눌러 주세요."); }}>최신 답변을 확인했어요 · 내 선택 유지</button></div>}
      {message && !conflict && <button disabled={busy} onClick={() => void persist(draft)}>내 선택 다시 저장</button>}
      <p role="status">{busy ? "답변을 저장하고 있어요…" : "선택할 때마다 저장해요. 건너뛰어도 안내를 볼 수 있어요."}</p>
    </article>
  </section>;
    if (view === "hospital")
        return <section className="advisor-stack" aria-label="병원에서 물어보기">
    <button className="secondary advisor-back" onClick={() => open("home")}>← 오늘로 돌아가기</button>
    <article className="private-card advisor-detail"><span className="advisor-eyebrow">의사에게 · 진료할 때</span><h2>병원에 가서<br />이렇게 물어봐요</h2><p>일을 계속해도 괜찮은지 의료진에게 확인하면, 필요한 치료와 회사에 요청할 조정을 준비할 수 있어요.</p><ol><li>어떤 일을 하고 어디가 불편한지 설명해요.</li><li>검사가 필요한지, 줄여야 할 작업이 있는지 물어봐요.</li><li>받은 설명과 서류를 나중에 확인할 수 있게 남겨요.</li></ol></article>
    <AdvisorScript data={data} reload={reload}/>
    <article className="private-card"><h3>병원에서 답을 들었나요?</h3><p>실제로 들은 내용만 골라 주세요. 아직 진료 전이어도 괜찮아요.</p><div className="advisor-choices"><button onClick={() => begin(2)}>들은 이야기 확인하기</button><button className="secondary" onClick={() => open("home")}>아직 안 갔어요 · 오늘로</button></div></article>
  </section>;
    return <section className="advisor-stack" aria-label="오늘의 산재 도움">
    <div className="advisor-state"><span className="advisor-state-dot"/><div><strong>{summary.label}</strong><small>{summary.source}</small></div></div>
    <article className="private-card advisor-primary"><span className="advisor-eyebrow">오늘 먼저 할 일</span>
      <h2>{summary.review ? "확인한 진행 상황을\n다시 살펴봐요" : "병원에서 일을 계속해도\n괜찮은지 물어봐요"}</h2>
      <p>{summary.review ? "이전에 적어 둔 내용과 지금 상황이 같은지 확인해요. 기존 기록과 원본은 그대로 보관돼 있어요." : "의료진에게 현재 하는 일과 불편한 증상을 설명해 주세요. 치료와 다음 준비를 정하는 데 도움이 돼요."}</p>
      <button className="advisor-main-cta" onClick={() => summary.review ? navigate("progress") : open("hospital")}>{summary.review ? "내 진행 상황 보기" : "병원에 이렇게 말하기"}<span aria-hidden="true">→</span></button>
      <div className="advisor-inline-actions"><button className="secondary" onClick={() => begin(2)}>이미 물어봤어요</button><button className="secondary" onClick={() => begin()}>내 상황 알려주기</button></div>
    </article>
    {message && <p role="alert">{message}</p>}
    <div className="advisor-shortcuts"><button className="secondary" onClick={() => navigate("library")}><span>서류를 받았어요</span><small>사진·PDF 보관 상태 확인</small><b aria-hidden="true">↗</b></button><button className="secondary" onClick={() => begin()}><span>{stored ? "내 답변 다시 보기" : "아직 잘 모르겠어요"}</span><small>질문은 최대 3개, 나중에 해도 돼요</small><b aria-hidden="true">→</b></button></div>
    <button className="secondary advisor-progress-link" onClick={() => navigate("progress")}><span>내 진행 상황</span><span aria-hidden="true">→</span></button>
    <p className="advisor-footnote">일반적인 준비 안내예요. 진단과 기관의 결정은 확인된 자료를 기준으로 해요.</p>
  </section>;
}
export function AnswerSummary({ profile }: {
    profile: AdvisorProfile | null;
}) {
    return <ul className="advisor-answer-list">{QUESTIONS.map((q, i) => <li key={q.title}><small>{q.title}</small><strong>{answerText(i, profile?.answers[i] ?? null)}</strong></li>)}</ul>;
}
function AdvisorScript({ data, reload }: {
    data: CaseData;
    reload: () => Promise<void>;
}) {
    const record = data.records.find(r => r.id === scriptId(data.caseId) && !r.archivedAt);
    const text = record?.payload.body ?? HOSPITAL_SCRIPT;
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
        await saveRecord(scriptId(data.caseId), base?.revision ?? 0, scriptPayload(draft));
        await reload();
        setEditing(false);
        setMessage("저장했어요. 실제로 전달할 문장만 복사할 수 있어요.");
    }
    catch (e) {
        if (e instanceof ApiError && e.code === "REVISION_CONFLICT") {
            const latest = await privateRequest<{
                record: CaseRecord;
            }>("private/case/records/" + scriptId(data.caseId)).catch(() => null);
            setConflict(latest?.record ?? null);
        }
        setMessage("저장하지 못했어요. 작성한 문장은 남아 있어요. 최신 내용을 확인하고 다시 저장해 주세요.");
    }
    finally {
        setBusy(false);
    } };
    return <article className="private-card advisor-script" onPointerDown={down} onPointerMove={e => { if (Math.hypot(e.clientX - point.current.x, e.clientY - point.current.y) > 8)
        cancel(); }} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}>
    <h3>그대로 말하거나 보여 주세요</h3>
    <div className="advisor-copy-bar"><button className="secondary" onClick={async () => { try {
        await navigator.clipboard.writeText(editing ? draft : text);
        setMessage("복사했어요. 필요한 곳에 직접 붙여 넣어 주세요.");
    }
    catch {
        setMessage("복사하지 못했어요. 아래 문장을 길게 눌러 직접 선택할 수 있어요.");
    } }}>문장 복사</button>{!editing && <button className="secondary" onClick={edit}>문장 편집</button>}</div>
    {editing ? <><label htmlFor="advisor-hospital-script">전달할 문장</label><textarea id="advisor-hospital-script" value={draft} maxLength={60000} rows={9} onChange={e => setDraft(e.target.value)}/><div className="private-actions"><button disabled={busy || !!conflict || !draft.trim()} onClick={() => void save()}>문장 저장</button><button className="secondary" disabled={busy} onClick={() => { setEditing(false); setDraft(text); setConflict(null); setMessage("편집을 취소했어요. 저장된 문장은 그대로예요."); }}>취소</button></div></> : <p className="advisor-script-body">{text}</p>}
    {conflict && <div className="conflict-panel"><h4>다른 기기의 최신 문장</h4><p className="advisor-script-body">{conflict.payload.body}</p><button className="secondary" onClick={() => { setBase(conflict); setConflict(null); }}>최신 문장 확인 · 내 작성문 유지</button></div>}
    <p role="status">{message}</p><small>{record ? "저장된 문장 · 수정 이력은 내 관리함에서 볼 수 있어요" : "기본 안내 문장 · 내 상황에 맞게 바꿀 수 있어요"}</small>
  </article>;
}
export function AdvisorProgress({ data, navigate }: {
    data: CaseData;
    navigate: (route: Route) => void;
}) {
    const profile = readProfile(data.records.find(r => r.id === profileId(data.caseId))), summary = advisorSummary(data.records, profile);
    return <section className="advisor-stack"><article className="private-card"><span className="advisor-eyebrow">산재 준비</span><h2>{summary.label}</h2><p>{summary.source}</p><p>다음에는 병원이나 공단에서 실제로 받은 안내와 서류를 확인해요.</p>{profile?.confirmed && <AnswerSummary profile={profile}/>}<button className="secondary" onClick={() => navigate("manage")}>기존 기록 자세히 보기</button></article><article className="private-card"><span className="advisor-eyebrow">퇴사·실업급여</span><h2>산재와 따로 확인해요</h2><p>퇴사 여부와 사유, 몸 상태, 고용보험 자료를 확인해야 해요. 여기서는 수급 가능 여부나 금액을 확정하지 않아요.</p><button className="secondary" onClick={() => navigate("manage")}>직장·지급 기록 확인하기</button></article></section>;
}
export function AdvisorHelp() { return <section className="advisor-stack"><article className="private-card"><h2>모르는 내용이 있어도 괜찮아요</h2><p>오늘 먼저 할 일에서 물어볼 문장을 읽거나 복사해 보세요. 질문에는 ‘잘 모르겠어요’를 고를 수 있어요.</p><h3>기관에 직접 물어볼 때</h3><p>산재 신청·진행: 근로복지공단</p><a className="private-button" href="tel:15880075">1588-0075 전화하기</a><p>퇴사·고용보험: 고용노동부</p><a className="private-button" href="tel:1350">1350 전화하기</a><p>버튼을 눌러야 전화 앱이 열려요. 앱이 대신 신청하거나 메시지를 보내지는 않아요.</p></article></section>; }
