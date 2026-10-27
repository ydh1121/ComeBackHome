import { useRef, useState } from 'react';
import { ApiError } from '../../auth/client';
import type { CaseRecord } from '../domain/records';
import type { CaseData } from '../ui/types';
import { Icon } from '../../../shared/components/Icon';
import { answerText, emptyProfile, profileId, profilePayload, QUESTIONS, readProfile, type AdvisorProfile } from './model';
import { latestAdvisorRecord, saveAdvisorRecord } from './storage';

export function AnswerSummary({ profile }: { profile: AdvisorProfile | null }) {
  return <ul className="advisor-answer-list">{QUESTIONS.map((q, i) => <li key={q.title}><small>{q.title}</small><strong>{answerText(i, profile?.answers[i] ?? null)}</strong></li>)}</ul>;
}

export function AdvisorProfileForm({ data, reload, onBack }: { data: CaseData; reload: () => Promise<void>; onBack: () => void }) {
  const stored = data.records.find(r => r.id === profileId(data.caseId));
  const [base, setBase] = useState(stored), [draft, setDraft] = useState(readProfile(stored) ?? emptyProfile());
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState<CaseRecord | null>(null);
  const latch = useRef(false), blocked = !!stored && (!readProfile(stored) || !!stored.archivedAt);
  const save = async (next: AdvisorProfile, close = false) => {
    if (latch.current || blocked) return;
    latch.current = true; setBusy(true); setError(''); setDraft(next);
    try {
      setBase(await saveAdvisorRecord(profileId(data.caseId), base?.revision ?? 0, profilePayload(next)));
      setConflict(null); await reload(); if (close) onBack();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'REVISION_CONFLICT') {
        setConflict(await latestAdvisorRecord(profileId(data.caseId)));
        setError('다른 기기에서 답변을 바꿨어요. 최신 답변을 확인해 주세요.');
      } else setError('답변을 저장하지 못했어요. 선택한 내용은 그대로예요. 다시 저장해 주세요.');
    } finally { latch.current = false; setBusy(false); }
  };
  const disabled = busy || blocked || !!conflict || !!error;
  return <section className="advisor-stack" aria-label="내 상황 확인">
    <button className="secondary advisor-back" disabled={busy} onClick={onBack}><Icon name="chevron-left"/>오늘로</button>
    <article className="private-card advisor-question">
      <span className="advisor-eyebrow">내 상황 · {Math.min(draft.cursor + 1, 3)} / 3</span>
      <h2>{draft.cursor < 3 ? QUESTIONS[draft.cursor].title : '답변을 확인해 주세요'}</h2>
      <p>잘 모르는 항목은 건너뛰어도 돼요.</p>
      {blocked && <p role="alert">저장한 답변을 열지 못했어요. 기존 내용은 그대로 보관돼 있어요.</p>}
      {draft.cursor < 3 ? <div className="advisor-choices">{[...QUESTIONS[draft.cursor].options, [null, '잘 모르겠어요']].map(([value, title]) => <button className="secondary" disabled={disabled} key={String(value)} onClick={() => {
        const answers = [...draft.answers]; answers[draft.cursor] = value;
        void save({ ...draft, answers, cursor: draft.cursor + 1, confirmed: false, deferred: false });
      }}>{title}<Icon name="chevron-right"/></button>)}</div> : <>
        <AnswerSummary profile={draft}/><p className="advisor-note">답변은 내가 알려준 내용으로 저장돼요. 기관의 결정과는 구분해요.</p>
        <div className="private-actions"><button disabled={disabled} onClick={() => void save({ ...draft, confirmed: true, deferred: false }, true)}>답변 저장</button><button className="secondary" disabled={busy || blocked} onClick={() => setDraft({ ...draft, cursor: 0, confirmed: false })}>다시 선택</button></div>
      </>}
      <button className="secondary advisor-later" disabled={disabled} onClick={() => void save({ ...draft, deferred: true }, true)}>나중에 할게요</button>
      {error && <p role="alert">{error}</p>}
      {conflict && <div className="conflict-panel"><h3>다른 기기의 답변</h3><AnswerSummary profile={readProfile(conflict)}/><button className="secondary" disabled={busy} onClick={() => { setBase(conflict); setConflict(null); setError('최신 답변을 확인했어요. 내 선택을 저장하려면 다시 저장을 눌러 주세요.'); }}>내 선택 유지</button></div>}
      {error && !conflict && <button disabled={busy || blocked} onClick={() => void save(draft)}>다시 저장</button>}
      <p role="status">{busy ? '답변 저장 중…' : '선택할 때마다 저장돼요.'}</p>
    </article>
  </section>;
}
