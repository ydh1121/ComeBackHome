import { useState } from 'react';
import { Icon } from '../../../shared/components/Icon';
import type { CaseData } from '../ui/types';
import { advisorSummary, profileId, readProfile } from './model';
import { AdvisorProfileForm, AnswerSummary } from './AdvisorProfile';
import { AdvisorScript } from './AdvisorScript';
import { AdvisorResponse } from './AdvisorResponse';
import { adviceScriptId, recommend, SCENARIOS, scenario, type Advice } from './scenarios';
import './advisor.css';
export { AnswerSummary } from './AdvisorProfile';

type Route = 'today' | 'progress' | 'library' | 'manage' | 'help';
type Props = { data: CaseData; reload: () => Promise<void>; navigate: (route: Route) => void };
function initialAction() {
  const id = new URLSearchParams(location.search).get('action');
  return id === 'hospital' ? 'A' : id && scenario(id) ? id : null;
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
  const spec = action ? scenario(action) : null;
  if (spec) return <section className="advisor-stack advisor-action" key={spec.id} aria-label={spec.category}>
    <button className="secondary advisor-back" onClick={() => open(null)}><Icon name="chevron-left"/>오늘로</button>
    <header className="advisor-detail"><span className="advisor-eyebrow">{spec.category}</span><h2>{spec.title}</h2><p>{spec.reason}</p><span className="advisor-recipient">{spec.recipient}에게</span></header>
    <section className="advisor-steps" aria-label="할 일"><h3>이 순서로 해보세요</h3><ol>{spec.steps.map((step, i) => <li key={step}><span aria-hidden="true">{i + 1}</span><p>{step}</p></li>)}</ol></section>
    <AdvisorScript key={spec.id} data={data} reload={reload} id={adviceScriptId(data.caseId, spec.id)} fallback={spec.script} recipient={spec.recipient}/>
    <details className="advisor-materials"><summary>준비할 자료 <span>{spec.materials.length}가지</span></summary><ul>{spec.materials.map(item => <li key={item}>{item}</li>)}</ul><p>아직 없는 자료는 담당자에게 준비 방법을 물어보세요.</p></details>
    <AdvisorResponse key={spec.id} data={data} spec={spec} reload={reload} onNext={open}/>
    <p className="advisor-footnote">{spec.caution}</p>
    {advice.find(a => a.scenario.id === spec.id) && <Evidence advice={advice.find(a => a.scenario.id === spec.id)!} data={data}/>}
  </section>;
  return <section className="advisor-home" aria-label="오늘의 산재 도움">
    <article className="private-card advisor-primary">
      <div className="advisor-card-heading"><span className="advisor-eyebrow">지금 할 일</span><span className="advisor-category">{primary.scenario.category}</span></div>
      <h2>{primary.scenario.title}</h2><p>{primary.scenario.reason}</p>
      <button className="advisor-main-cta" onClick={() => open(primary.scenario.id)}>물어볼 내용 보기<Icon name="chevron-right"/></button>
      <button className="secondary advisor-inline-link" onClick={() => setQuestions(true)}>{stored ? '내 상황 다시 확인' : '내 상황 알려주기'}<Icon name="chevron-right"/></button>
      <Evidence advice={primary} data={data}/>
    </article>
    <aside className="advisor-side">
      <div className="advisor-section-heading"><h2>필요할 때 바로</h2></div>
      <div className="advisor-shortcuts">
        <button className="secondary" onClick={() => navigate('library')}><Icon name="file"/><span><strong>받은 서류 보관하기</strong><small>사진이나 PDF를 모아두세요</small></span><Icon name="chevron-right"/></button>
        <button className="secondary" onClick={() => navigate('progress')}><Icon name="calendar"/><span><strong>진행 상황 확인</strong><small>산재와 실업급여를 각각 확인해요</small></span><Icon name="chevron-right"/></button>
      </div>
      {advice.length > 1 && <div className="advisor-related"><h3>함께 확인할 일</h3>{advice.slice(1,3).map(a => <button className="secondary" key={a.scenario.id} onClick={() => open(a.scenario.id)}><span>{a.scenario.category}</span><Icon name="chevron-right"/></button>)}</div>}
      <button className="secondary advisor-contact-link" onClick={() => navigate('help')}><Icon name="phone"/>기관 연락처 보기</button>
    </aside>
  </section>;
}
export function AdvisorProgress({ data, navigate }: { data: CaseData; navigate: (route: Route) => void }) {
  const profile = readProfile(data.records.find(r => r.id === profileId(data.caseId))), summary = advisorSummary(data.records, profile);
  return <section className="advisor-stack advisor-progress">
    <header className="advisor-section-heading"><div><span className="advisor-eyebrow">내 진행 상황</span><h2>어디까지 진행했는지 확인하세요</h2></div></header>
    <article className="private-card"><span className="advisor-eyebrow">산재</span><h3>{summary.label}</h3><p>{summary.source}</p>{profile?.confirmed && <details><summary>내가 남긴 답변</summary><AnswerSummary profile={profile}/></details>}<button className="secondary" onClick={() => navigate('manage')}>산재 기록 보기<Icon name="chevron-right"/></button></article>
    <article className="private-card"><span className="advisor-eyebrow">퇴사·실업급여</span><h3>퇴사 사유와 고용보험 이력을 확인하세요</h3><p>일할 수 있는 몸 상태인지도 함께 확인해야 해요. 수급 여부와 지급액은 고용센터의 결정에 따라 달라요.</p><button className="secondary" onClick={() => navigate('manage')}>직장·지급 기록 보기<Icon name="chevron-right"/></button></article>
  </section>;
}
export function AdvisorHelp({ onOpen }: { onOpen: (id: string) => void }) {
  return <section className="advisor-stack"><header className="advisor-section-heading"><div><span className="advisor-eyebrow">상황별 도움말</span><h2>지금 필요한 내용을 찾아보세요</h2></div></header>
    <div className="advisor-help-list">{SCENARIOS.map(s => <button className="secondary" key={s.id} onClick={() => onOpen(s.id)}><span><small>{s.category}</small><strong>{s.title}</strong></span><Icon name="chevron-right"/></button>)}</div>
    <article className="private-card advisor-contacts"><h3>기관에 문의하기</h3><a href="tel:15880075"><span><strong>근로복지공단</strong><small>산재 신청·심사 · 1588-0075</small></span><Icon name="phone"/></a><a href="tel:1350"><span><strong>고용노동부</strong><small>퇴사·고용보험 · 1350</small></span><Icon name="phone"/></a></article>
  </section>;
}
