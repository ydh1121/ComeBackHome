import { useState } from 'react';
import { Icon } from '../../../shared/components/Icon';
import type { CaseData } from '../ui/types';
import { advisorSummary, profileId, readProfile } from './model';
import { AdvisorProfileForm, AnswerSummary } from './AdvisorProfile';
import { AdvisorScript } from './AdvisorScript';
import { AdvisorResponse } from './AdvisorResponse';
import { ReemploymentAdvice } from './ReemploymentAdvice';
import { adviceScriptId, recommend, SCENARIOS, scenario, type Advice } from './scenarios';
import { EditableGuidance } from '../content/EditableGuidance';
import { guidanceText } from '../content/model';
import { PersonalHistoryReview, PlanningGuides } from '../content/PlanningReview';
import './advisor.css';
export { AnswerSummary } from './AdvisorProfile';

type Route = 'today' | 'progress' | 'library' | 'manage' | 'help';
type Props = { data: CaseData; reload: () => Promise<void>; navigate: (route: Route) => void };
function initialAction() {
  const id = new URLSearchParams(location.search).get('action');
  return id === 'hospital' ? 'A' : id === 'reemployment' || (id && scenario(id)) ? id : null;
}
function Evidence({ advice, data }: { advice: Advice; data: CaseData }) {
  if (!advice.sources.length && !advice.due) return null;
  return <details className="advisor-evidence"><summary>이 안내가 나온 이유</summary>
    {advice.due && <p>{advice.due.date} · {advice.due.kind === 'recommended' ? '준비 권장일' : advice.due.kind === 'legal_check' ? '법정기한 확인 필요' : '기록된 기관 일정'}{advice.due.overdue ? ' · 날짜가 지났어요. 담당 기관에 문의하세요.' : ''}</p>}
    {advice.sources.map(id => { const r = data.records.find(r => r.id === id); return r ? <p key={id}>{r.payload.title}<small>{r.payload.certainty === 'official' ? '기관 자료를 연결한 기록' : r.payload.certainty === 'documented' ? '서류를 확인한 기록' : '직접 남긴 내용 · 기관 확인 전'}</small></p> : null; })}
  </details>;
}
export function AdvisorHome({ data, reload, navigate }: Props) {
  const [action, setAction] = useState<string | null>(initialAction), [questions, setQuestions] = useState(false);
  const advice = recommend(data), primary = advice[0], stored = data.records.find(r => r.id === profileId(data.caseId));
  const open = (id: string | null) => {
    setQuestions(false); setAction(id);
    history.replaceState(null, '', '/injury?section=today' + (id ? '&action=' + id : ''));
    window.scrollTo(0, 0);
  };
  if (questions) return <AdvisorProfileForm data={data} reload={reload} onBack={() => open(null)}/>;
  if (action === 'reemployment') return <ReemploymentAdvice data={data} reload={reload} onBack={() => open(null)}/>;
  const spec = action ? scenario(action) : null;
  if (spec) return <section className="advisor-stack advisor-action" key={spec.id} aria-label={spec.category}>
    <button className="secondary advisor-back" onClick={() => open(null)}><Icon name="chevron-left"/>오늘로</button>
    <header className="advisor-detail"><span className="advisor-eyebrow">{spec.category}</span><h2>{spec.title}</h2><EditableGuidance data={data} reload={reload} contentKey={spec.id+"-reason"} title="안내 이유" fallback={spec.reason}>{text=><p>{text}</p>}</EditableGuidance><span className="advisor-recipient">{spec.recipient}에게</span></header>
    <section className="advisor-steps" aria-label="할 일"><h3>이 순서로 해보세요</h3><EditableGuidance data={data} reload={reload} contentKey={spec.id+"-steps"} title="안내 순서" fallback={spec.steps.join("\n")}>{text=><ol>{text.split("\n").filter(Boolean).map((step,i)=><li key={i}><span aria-hidden="true">{i+1}</span><p>{step}</p></li>)}</ol>}</EditableGuidance></section>
    <AdvisorScript key={spec.id} data={data} reload={reload} id={adviceScriptId(data.caseId, spec.id)} fallback={spec.script} recipient={spec.recipient}/>
    <details className="advisor-materials"><summary>준비할 자료 <span>{spec.materials.length}가지</span></summary><EditableGuidance data={data} reload={reload} contentKey={spec.id+"-materials"} title="준비할 자료" fallback={spec.materials.join("\n")}>{text=><ul>{text.split("\n").filter(Boolean).map((item,i)=><li key={i}>{item}</li>)}</ul>}</EditableGuidance><p>아직 없는 자료는 담당자에게 준비 방법을 물어보세요.</p></details>
    <AdvisorResponse key={spec.id} data={data} spec={spec} reload={reload} onNext={open}/>
    <EditableGuidance data={data} reload={reload} contentKey={spec.id+"-caution"} title="참고할 내용" fallback={spec.caution}>{text=><p className="advisor-footnote">{text}</p>}</EditableGuidance>
    {advice.find(a => a.scenario.id === spec.id) && <Evidence advice={advice.find(a => a.scenario.id === spec.id)!} data={data}/>}
  </section>;
  return <section className="advisor-home" aria-label="오늘의 산재 도움">
    <article className="private-card advisor-primary">
      <div className="advisor-card-heading"><span className="advisor-eyebrow">지금 할 일</span><span className="advisor-category">{primary.scenario.category}</span></div>
      <h2>{primary.scenario.title}</h2><p>{guidanceText(data.records,data.caseId,primary.scenario.id+"-reason",primary.scenario.reason)}</p>
      <button className="advisor-main-cta" onClick={() => open(primary.scenario.id)}>물어볼 내용 보기<Icon name="chevron-right"/></button>
      <button className="secondary advisor-inline-link" onClick={() => setQuestions(true)}>{stored ? '내 상황 다시 확인' : '내 상황 알려주기'}<Icon name="chevron-right"/></button>
      <Evidence advice={primary} data={data}/>
    </article>
    <aside className="advisor-side">
      <div className="advisor-section-heading"><h2>바로가기</h2></div>
      <div className="advisor-shortcuts">
        <button className="secondary" onClick={() => open('reemployment')}><Icon name="calendar"/><span><strong>다른 직장에 취업해도 될까요?</strong></span><Icon name="chevron-right"/></button>
        <button className="secondary" onClick={() => navigate('library')}><Icon name="file"/><span><strong>받은 서류 보관하기</strong></span><Icon name="chevron-right"/></button>
        <button className="secondary" onClick={() => navigate('progress')}><Icon name="calendar"/><span><strong>진행 상황 확인</strong></span><Icon name="chevron-right"/></button>
      </div>
      {advice.length > 1 && <div className="advisor-related"><h3>함께 확인할 일</h3>{advice.slice(1,3).map(a => <button className="secondary" key={a.scenario.id} onClick={() => open(a.scenario.id)}><span>{a.scenario.category}</span><Icon name="chevron-right"/></button>)}</div>}
      <PersonalHistoryReview data={data} reload={reload}/><PlanningGuides data={data} reload={reload}/>
      <button className="secondary advisor-contact-link" onClick={() => navigate('help')}><Icon name="phone"/>기관 연락처 보기</button>
    </aside>
  </section>;
}
export function AdvisorProgress({ data, navigate }: { data: CaseData; navigate: (route: Route) => void }) {
  const profile = readProfile(data.records.find(r => r.id === profileId(data.caseId))), summary = advisorSummary(data.records, profile);
  return <section className="advisor-stack advisor-progress">
    <header className="advisor-section-heading"><div><h2>진행 상황</h2></div></header>
    <article className="private-card"><span className="advisor-eyebrow">산재</span><h3>{summary.label}</h3><p>{summary.source}</p>{profile?.confirmed && <details><summary>내가 남긴 답변</summary><AnswerSummary profile={profile}/></details>}<button className="secondary" onClick={() => navigate('manage')}>산재 기록 보기<Icon name="chevron-right"/></button></article>
    <article className="private-card"><span className="advisor-eyebrow">퇴사·실업급여</span><h3>퇴사 사유와 고용보험 이력을 확인하세요</h3><p>일할 수 있는 몸 상태인지도 함께 확인해야 해요. 수급 여부와 지급액은 고용센터의 결정에 따라 달라요.</p><button className="secondary" onClick={() => navigate('manage')}>직장·지급 기록 보기<Icon name="chevron-right"/></button></article>
  </section>;
}
export function AdvisorHelp({ onOpen, data, reload }: { onOpen: (id: string) => void; data:CaseData; reload:()=>Promise<void> }) {
  return <section className="advisor-stack"><header className="advisor-section-heading"><div><h2>상황별 도움말</h2></div></header>
    <button className="secondary reemployment-entry" onClick={() => onOpen('reemployment')}>다른 직장에 취업해도 될까요?<Icon name="chevron-right"/></button>
    <div className="advisor-help-list">{SCENARIOS.map(s => <button className="secondary" key={s.id} onClick={() => onOpen(s.id)}><span><small>{s.category}</small><strong>{s.title}</strong></span><Icon name="chevron-right"/></button>)}</div>
    <article className="private-card advisor-contacts"><h3>기관에 문의하기</h3>{[['contact-work','근로복지공단\n산재 신청·심사\n1588-0075'],['contact-employment','고용노동부\n퇴사·고용보험\n1350']].map(([key,fallback])=><EditableGuidance key={key} data={data} reload={reload} contentKey={key} title="기관 연락처" fallback={fallback}>{text=>{const [name,description,phone]=text.split('\n');return phone&&/^[+\d(). -]{3,20}$/.test(phone)?<a href={'tel:'+phone.replace(/[^+\d]/g,'')}><span><strong>{name}</strong><small>{description} · {phone}</small></span><Icon name="phone"/></a>:<p className="record-body">{text}</p>;}}</EditableGuidance>)}</article>
  </section>;
}
