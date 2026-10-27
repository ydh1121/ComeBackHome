import { useRef, useState } from 'react';
import { ApiError } from '../../auth/client';
import type { CaseData } from '../ui/types';
import type { CaseRecord } from '../domain/records';
import { currentResponse, readResponse, responseBasis, responseId, responsePayload, type Scenario } from './scenarios';
import { latestAdvisorRecord, saveAdvisorRecord } from './storage';
import { EditableGuidance } from '../content/EditableGuidance';

export function AdvisorResponse({ data, spec, reload, onNext }: { data: CaseData; spec: Scenario; reload: () => Promise<void>; onNext: (id: string) => void }) {
  const id = responseId(data.caseId, spec.id), stored = data.records.find(r => r.id === id), value = currentResponse(data, spec.id);
  const [base, setBase] = useState(stored), [answer, setAnswer] = useState(value?.answer ?? null);
  const [saved, setSaved] = useState(value), [error, setError] = useState(''), [busy, setBusy] = useState(false), [conflict, setConflict] = useState<CaseRecord | null>(null);
  const latch = useRef(false), blocked = !!stored && (!readResponse(stored) || !!stored.archivedAt);
  const save = async (deferred: boolean) => {
    if (latch.current || blocked || (!deferred && !answer)) return;
    latch.current = true; setBusy(true); setError('');
    const next = { version: 1 as const, scenario: spec.id, answer: deferred ? saved?.answer ?? null : answer, deferred, basis: responseBasis(data), at: new Date().toISOString() };
    try { setBase(await saveAdvisorRecord(id, base?.revision ?? 0, responsePayload(next))); setSaved(next); await reload(); }
    catch (e) {
      if (e instanceof ApiError && e.code === 'REVISION_CONFLICT') setConflict(await latestAdvisorRecord(id));
      setError('답변을 저장하지 못했어요. 선택한 내용은 그대로예요.');
    } finally { latch.current = false; setBusy(false); }
  };
  const nextId = saved && !saved.deferred ? spec.options.find(([key]) => key === saved.answer)?.[2] : undefined;
  const followup = saved && !saved.deferred && saved.answer ? spec.replyGuidance?.[saved.answer] : undefined;
  return <article className="private-card advisor-response">
    <h3>{spec.question}</h3><p>실제로 들은 답을 골라 주세요.</p>
    <fieldset className="advisor-radio-list" disabled={busy || !!conflict || blocked}><legend className="advisor-sr-only">{spec.question}</legend>{spec.options.map(([key, label]) => <label key={key} className={answer === key ? 'selected' : ''}><input type="radio" name={`reply-${spec.id}`} value={key} checked={answer === key} onChange={() => { setAnswer(key); setError(''); }}/><span>{label}</span></label>)}</fieldset>
    <div className="private-actions"><button disabled={busy || !answer || !!conflict || blocked} onClick={() => void save(false)}>답변 남기기</button><button className="secondary" disabled={busy || !!conflict || blocked} onClick={() => void save(true)}>나중에 할게요</button></div>
    {blocked && <p role="alert">기존 답변을 열지 못했어요. 저장된 내용은 바꾸지 않았어요.</p>}
    {error && <p role="alert">{error}</p>}
    {conflict && <div className="conflict-panel"><h4>다른 기기에서 답변을 바꿨어요</h4><p>{spec.options.find(([key]) => key === readResponse(conflict)?.answer)?.[1] ?? '아직 답변 전이에요'}</p><button className="secondary" onClick={() => { setBase(conflict); setConflict(null); }}>내 선택 유지</button></div>}
    <p role="status">{busy ? '답변 저장 중…' : saved?.deferred ? '나중에 이어서 볼 수 있어요.' : saved ? '내 답변을 저장했어요. 기관에 신청한 것은 아니에요.' : ''}</p>
    {followup && <section className="advisor-reply-guidance"><h4>{followup.title}</h4><EditableGuidance data={data} reload={reload} contentKey={spec.id+'-reply-'+saved!.answer} title="답변 후 안내" fallback={followup.body}/></section>}
    {nextId && <button className="secondary advisor-next" onClick={() => onNext(nextId)}>다음 안내 보기</button>}
  </article>;
}
