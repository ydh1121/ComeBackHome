import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../../shared/components/Icon';
import { EditableGuidance } from '../content/EditableGuidance';
import { guidanceId } from '../content/model';
import type { CaseData } from '../ui/types';
import { AdvisorScript } from './AdvisorScript';
import { adviceScriptId } from './scenarios';
import { getReemploymentContext, reemploymentStorageKey, type ReemploymentIntent, type ReemploymentStage } from './reemployment';

const STAGES: Array<[ReemploymentStage, string]> = [
  ['applied', '신청·심사 중이에요'], ['treatment', '치료를 받는 중이에요'],
  ['ended', '치료가 끝났어요'], ['disability', '장해급여를 받은 뒤예요'],
  ['unemployment', '구직급여를 받는 중이에요'], ['unknown', '아직 잘 모르겠어요'],
];
type Guide = { reason: string; steps: string[]; materials: string[]; caution: string; agency: string };
const GUIDES: Record<ReemploymentStage, Guide> = {
  applied: {
    reason: '산재를 신청했거나 심사 중이라는 이유만으로 다른 직장에 취업할 수 없는 것은 아니에요. 새 업무를 할 수 있는 몸 상태인지, 심사에 추가로 필요한 자료가 있는지 확인하세요.',
    steps: ['의사에게 새 업무를 해도 되는지, 피해야 할 작업이 있는지 물어보세요.', '근로복지공단에 취업일·업무·근로시간·임금을 알리고, 심사에 필요한 자료와 이후 휴업급여에 미치는 영향을 확인하세요.', '안내받은 내용과 새 직장 정보를 기존 기록에 남겨 두세요.'],
    materials: ['산재 접수·심사 안내문과 진료자료', '새 직장 근로계약서 또는 입사 예정 안내', '업무내용·근로시간·임금을 확인할 자료'],
    caution: '새 직장에 취업했다고 산재 승인이 자동으로 취소되는 것은 아니에요. 심사 결과와 급여 지급 여부는 기관에서 각각 판단해요.',
    agency: '산재 신청·심사 중입니다. 취업일, 업무내용, 근로시간, 임금을 알려 드리면 심사와 휴업급여에 어떤 영향이 있는지, 추가로 낼 자료가 무엇인지 확인해 주세요.',
  },
  treatment: {
    reason: '요양기간과 휴업급여를 인정받는 기간은 같지 않을 수 있어요. 치료 중 일을 하면 실제 일한 날과 임금, 치료 상태를 기준으로 휴업급여를 확인해야 해요.',
    steps: ['의사에게 새 업무가 치료를 늦추거나 증상을 악화시키지 않는지 확인하고 소견을 요청하세요.', '근로복지공단에 사업장·업무·취업기간·근로시간·임금을 알리고 부분휴업급여 적용 여부와 필요한 서류를 물어보세요.', '실제로 일한 날짜와 받은 임금을 남기고, 기관 결정이 나온 뒤 지급장부에 반영하세요.'],
    materials: ['근로계약서와 사업장·업무·취업기간·임금 자료', '실제 근무일·근로시간·급여를 확인할 자료', '취업해도 치유가 늦어지거나 상태가 악화되지 않는다는 의사 소견'],
    caution: '부분휴업급여는 치료 중 일정 기간 또는 짧은 시간 일하는 경우 검토할 수 있는 제도예요. 사업장·업무가 정해져 있고 의사 소견 등 요건을 갖춰야 해요. 취업만으로 휴업급여 전액이 취소되거나 전액 지급된다고 판단할 수는 없어요.',
    agency: '현재 요양 중입니다. 사업장, 업무, 취업기간, 실제 근무일·시간과 임금, 의사 소견을 기준으로 부분휴업급여 대상인지 확인해 주세요. 어떤 서류를 언제 제출해야 하나요?',
  },
  ended: {
    reason: '요양이 끝난 뒤에도 현재 몸 상태에 맞는 업무인지 확인하는 것이 좋아요. 요양종결과 실제로 일할 수 있는 범위는 구분해서 확인하세요.',
    steps: ['의사에게 가능한 업무와 피해야 할 작업·근로시간을 확인하세요.', '요양종결 결정문을 확인하고, 남아 있는 증상이나 지급·신청 사항은 근로복지공단에 물어보세요.', '새 직장과 실제 근무내용을 기존 직장 기록에 남겨 두세요.'],
    materials: ['요양종결 결정문과 최근 진료자료', '새 직장 근로계약서·업무내용', '남아 있는 증상과 업무상 부담을 적은 메모'],
    caution: '취업 후 증상이 다시 심해지면 진료를 받고 기존 질환의 재요양인지, 새 업무상 재해인지 기관에 확인하세요.',
    agency: '요양이 끝난 상태입니다. 요양종결 결정과 관련해 추가로 확인하거나 신고할 사항이 있나요? 남아 있는 증상이나 보상에 관해 어떤 자료를 준비하면 되나요?',
  },
  disability: {
    reason: '장해급여를 받았다는 이유만으로 취업이 금지되는 것은 아니에요. 현재 업무수행 가능 범위와 실제 지급결정에 따른 확인사항을 살펴보세요.',
    steps: ['의사에게 새 업무를 할 수 있는지, 제한해야 할 작업이 있는지 확인하세요.', '근로복지공단에 장해급여 결정 내용을 보여 주고 취업 시 신고·확인이 필요한 사항을 물어보세요.', '새 직장 기록과 기관 답변을 남기고, 변경 결정이 있을 때 지급장부에 반영하세요.'],
    materials: ['장해급여 결정문', '최근 진료자료와 업무수행 관련 소견', '새 직장의 업무·근로시간·임금 자료'],
    caution: '새 직장에 취업했다는 사실만으로 장해급여 결정이 자동 취소된다고 보지 않아요. 실제 결정 내용과 기관의 안내를 확인하세요.',
    agency: '장해급여 결정을 받았습니다. 제 결정 내용에 따라 취업 시 신고하거나 확인할 사항이 있나요? 변경되는 사항이 있다면 근거와 필요한 서류를 알려 주세요.',
  },
  unemployment: {
    reason: '구직급여를 받다가 실제로 취업하면 취업사실 신고와 지급대상 기간을 확인해야 해요. 회사의 고용보험 신고만으로 본인의 취업사실 신고를 대신할 수는 없어요.',
    steps: ['입사일과 실제 일을 시작한 날을 확인하세요.', '고용24의 실업급여 → 실업인정 → 취업사실 신고에서 신고 방법과 제출자료를 확인하세요.', '고용센터에 지급대상 기간과 조기재취업수당 검토 가능 여부를 물어보고, 결정 후 기존 지급장부에 반영하세요.'],
    materials: ['근로계약서 또는 재직증명서 등 취업을 확인할 자료', '입사일·실제 근무 시작일 자료', '기존 수급자격·실업인정 안내'],
    caution: '취업 예정만으로 구직급여를 자동 중단하지 마세요. 짧게 또는 일시적으로 일한 경우도 실업인정 때 신고해야 해요. 실제 취업일과 신고 시점, 지급대상 기간은 고용센터에 확인하세요.',
    agency: '구직급여를 받고 있습니다. 취업사실을 언제 어떤 자료로 신고해야 하나요? 어느 날까지 지급대상이 되는지, 조기재취업수당도 확인할 수 있는지 알려 주세요.',
  },
  unknown: {
    reason: '산재 심사, 요양, 휴업급여와 구직급여는 확인할 기관과 기준이 달라요. 최근 받은 결정문이나 안내문부터 확인하면 돼요.',
    steps: ['최근 받은 공단·고용센터 안내문에서 심사 상태, 요양기간과 급여 종류를 확인하세요.', '의사에게 현재 업무수행 가능 여부를 묻고, 근로복지공단에 취업 시 확인할 사항을 물어보세요.', '구직급여를 받고 있다면 고용센터에도 취업사실 신고 방법을 확인하세요.'],
    materials: ['최근 받은 결정문·안내문', '최근 진료자료', '새 직장 근로계약서 또는 예정 업무·시간·임금 자료'],
    caution: '상태가 확인되기 전에는 수급자격이나 지급액을 추정해 바꾸지 마세요. 기관 답변을 확인한 뒤 기존 기록을 수정하면 돼요.',
    agency: '현재 산재 신청·요양·급여 상태가 정확히 어떤 단계인지 확인하고 싶습니다. 취업과 관련해 어떤 사항을 알리고 어떤 서류를 내야 하나요?',
  },
};
const WORSENING = '기존 산재 질환이 재발·악화된 경우와 새 직장의 업무로 새로운 재해가 생긴 경우를 구분해야 해요. 같은 부위가 아프다는 이유만으로 한쪽으로 결정하지 않아요.\n먼저 진료를 받고, 기존 산재 결정문·진료자료와 새 직장의 업무내용·근로시간·증상 변화 기록을 준비하세요. 근로복지공단에 재요양 또는 신규 산재 신청 중 무엇을 검토해야 하는지 물어보세요.';
const PRIVACY = '산재 수급 이력만으로 새 직장에 취업할 수 없는 것은 아니고, 과거 산재 이력이 모든 새 회사에 일률적으로 자동 통보된다고 볼 수도 없어요.\n실제 업무수행 가능 여부 확인과 건강정보 수집은 별개의 문제예요. 회사가 건강자료를 요청하면 목적·법적 근거·필요한 범위·제공받는 대상을 확인하고, 해당 업무에 필요한 자료 범위를 물어보세요.';
const PERIOD_NAMES = { treatment: '요양기간', workers_comp_leave: '휴업급여 청구기간', unemployment: '구직급여 기록기간' };
const REVIEW_NAMES = { actual_overlap: '재직기간 겹침', planned_overlap: '취업 예정기간 겹침', possible_overlap: '기간 확인 필요', date_review: '날짜 확인 필요' };

/** Shows recorded intervals only; never makes a benefit or work-capacity decision. */
export function EmploymentReviewNotice({ data }: { data: CaseData }) {
  const context = getReemploymentContext(data.records);
  if (!context.overlaps.length) return null;
  const actualTreatment = context.overlaps.some(r => r.periodKind === 'treatment' && r.kind === 'actual_overlap');
  return <aside className="reemployment-review" aria-label="취업 기간 확인">
    <h3>{actualTreatment ? '요양기간과 재직기간이 겹쳐요' : '취업 기간을 함께 확인해 주세요'}</h3>
    <p>기록된 기간을 비교한 결과예요. 실제로 일한 날짜와 받은 임금을 확인하고, 산재 급여는 근로복지공단에, 구직급여는 고용센터에 문의하세요. 지급액과 수급자격은 이 안내로 바뀌지 않아요.</p>
    <details><summary>확인할 기록 {context.overlaps.length}건</summary><ul>{context.overlaps.map(review => {
      const job = context.employments.find(r => r.recordId === review.employmentId)!;
      const period = context.periods.find(r => r.recordId === review.periodId)!;
      return <li key={review.employmentId + '-' + review.periodId} data-reemployment-review-kind={review.kind}>
        <strong>{REVIEW_NAMES[review.kind]} · {PERIOD_NAMES[review.periodKind]}</strong>
        <span>{job.title} / {period.title}</span>
        <small>{review.kind === 'date_review' ? '날짜가 빠졌거나 맞지 않는 기록이 있어요.' : `${review.from ?? '시작일 확인 필요'} ~ ${review.to ?? '종료일 확인 필요'}`}{review.kind === 'possible_overlap' ? ' · 실제·예정 여부와 기간을 확인하세요.' : ''}</small>
      </li>;
    })}</ul></details>
    <Link to="/injury?section=today&action=reemployment">재취업 안내 보기<Icon name="chevron-right"/></Link>
  </aside>;
}

export function ReemploymentAdvice({ data, reload, onBack }: { data: CaseData; reload: () => Promise<void>; onBack: () => void }) {
  const [stage, setStage] = useState<ReemploymentStage | null>(null);
  const [intent, setIntent] = useState<ReemploymentIntent | null>(null);
  const heading = useRef<HTMLHeadingElement>(null), started = useRef(false);
  useEffect(() => { if (started.current) heading.current?.focus({ preventScroll: true }); started.current = true; }, [stage, intent]);
  const choose = (next: ReemploymentStage) => { setStage(next); setIntent(null); };
  const back = <button className="secondary advisor-back" onClick={onBack}><Icon name="chevron-left"/>오늘로</button>;
  if (!stage || !intent) return <section className="advisor-stack advisor-question reemployment-advice" aria-label="재취업 안내">
    {back}<article className="private-card">
      <span className="advisor-eyebrow">다른 직장에 취업해도 될까요?</span>
      <h2 ref={heading} tabIndex={-1}>{stage ? '새 직장에 취업했나요?' : '지금 어떤 상황인가요?'}</h2>
      <div className="advisor-choices">{stage ? <>
        <button className="secondary" onClick={() => setIntent('planned')}>취업할 예정이에요<Icon name="chevron-right"/></button>
        <button className="secondary" onClick={() => setIntent('working')}>이미 일하고 있어요<Icon name="chevron-right"/></button>
      </> : STAGES.map(([value, label]) => <button className="secondary" key={value} onClick={() => choose(value)}>{label}<Icon name="chevron-right"/></button>)}</div>
      {stage && <button className="secondary advisor-back" onClick={() => setStage(null)}><Icon name="chevron-left"/>이전 질문</button>}
    </article>
  </section>;
  const guide = GUIDES[stage], key = `reemployment-${stage}-${intent}`;
  const storageKey = reemploymentStorageKey(stage, intent);
  const working = intent === 'working', unemployment = stage === 'unemployment';
  const steps = [...guide.steps];
  if (unemployment && !working) {
    steps[0] = '입사 예정일과 실제 근무 시작일을 확인하세요.';
    steps[1] = '고용센터에 취업사실 신고 시점과 제출자료를 미리 물어보세요. 실제로 취업하면 고용24의 실업급여 → 실업인정 → 취업사실 신고를 확인하세요.';
  } else if (working && !unemployment) {
    steps[0] = '이미 일을 시작했다면 의사에게 현재 업무·근로시간과 증상 변화를 알리고 계속 일해도 되는지 확인하세요.';
  }
  const context = getReemploymentContext(data.records);
  const physician = `${working ? '새 직장에서 일을 시작했습니다.' : '새 직장에 취업할 예정입니다.'} 업무내용과 근로시간을 알려 드리면 현재 몸 상태로 할 수 있는지 확인해 주세요. 피해야 할 작업이나 시간 제한이 있나요?${stage === 'treatment' ? ' 이 업무가 치유를 늦추거나 상태를 악화시키지 않는지, 부분휴업급여 확인에 필요한 소견도 받을 수 있나요?' : ''}`;
  const agency = `${working ? '새 직장에서 이미 일을 시작했습니다.' : '새 직장에 취업할 예정입니다.'}\n${guide.agency}`;
  const paragraphs = (text: string) => text.split('\n').filter(Boolean).map((line, i) => <p key={i}>{line}</p>);
  return <section className="advisor-stack advisor-action reemployment-advice" aria-label="재취업 안내" data-reemployment-stage={stage} data-reemployment-intent={intent}>
    {back}<header className="advisor-detail"><span className="advisor-eyebrow">{STAGES.find(([value]) => value === stage)?.[1]}</span>
      <h2 ref={heading} tabIndex={-1}>{working ? '취업 후 확인할 일' : '취업 전에 확인할 일'}</h2>
      <button className="secondary advisor-back" onClick={() => { setStage(null); setIntent(null); }}>상황 다시 선택</button>
      <EditableGuidance key={key + '-reason'} data={data} reload={reload} contentKey={key + '-reason'} recordId={guidanceId(data.caseId, storageKey + '-reason')} title="재취업 안내 이유" fallback={guide.reason}>{paragraphs}</EditableGuidance>
    </header>
    <section className="advisor-steps" aria-label="재취업 후속 행동"><h3>다음에 할 일</h3><EditableGuidance data={data} reload={reload} contentKey={key + '-steps'} recordId={guidanceId(data.caseId, storageKey + '-steps')} title="재취업 확인 순서" fallback={steps.join('\n')}>{text => <ol>{text.split('\n').filter(Boolean).map((line, i) => <li key={i}><span aria-hidden="true">{i + 1}</span><p>{line}</p></li>)}</ol>}</EditableGuidance></section>
    <EditableGuidance data={data} reload={reload} contentKey={key + '-caution'} recordId={guidanceId(data.caseId, storageKey + '-caution')} title="급여 확인 시 참고할 내용" fallback={guide.caution}>{text => <p className="reemployment-caution">{text}</p>}</EditableGuidance>
    {!unemployment && <details className="advisor-materials reemployment-script"><summary>의사에게 물어볼 말</summary><AdvisorScript data={data} reload={reload} id={adviceScriptId(data.caseId, storageKey + '-physician')} fallback={physician} title="의사에게 물어볼 말" recipient="의사"/></details>}
    <details className="advisor-materials reemployment-script"><summary>{unemployment ? '고용센터에 물어볼 말' : '근로복지공단에 물어볼 말'}</summary><AdvisorScript data={data} reload={reload} id={adviceScriptId(data.caseId, storageKey + '-agency')} fallback={agency} title={unemployment ? '고용센터에 물어볼 말' : '근로복지공단에 물어볼 말'} recipient={unemployment ? '고용센터' : '근로복지공단'}/></details>
    <details className="advisor-materials"><summary>준비할 서류</summary><EditableGuidance data={data} reload={reload} contentKey={key + '-materials'} recordId={guidanceId(data.caseId, storageKey + '-materials')} title="재취업 확인 서류" fallback={guide.materials.join('\n')}>{text => <ul>{text.split('\n').filter(Boolean).map((line, i) => <li key={i}>{line}</li>)}</ul>}</EditableGuidance></details>
    <EmploymentReviewNotice data={data}/>
    <details className="advisor-materials"><summary>등록한 직장 정보</summary>{context.employments.length ? <ul className="reemployment-jobs">{context.employments.map(job => <li key={job.recordId}><strong>{job.employerName || job.title}</strong><span>{job.kind === 'actual' ? '실제 직장' : job.kind === 'planned' ? '취업 예정' : '실제·예정 구분 확인 필요'}</span><dl>
      <div><dt>입사일</dt><dd>{job.hireDate ?? '확인 필요'}</dd></div><div><dt>업무</dt><dd>{job.jobTitle || '확인 필요'}</dd></div><div><dt>주당 근로시간</dt><dd>{job.weeklyHours === null ? '확인 필요' : job.weeklyHours + '시간'}</dd></div><div><dt>임금</dt><dd>{job.wage === null ? '확인 필요' : job.wage.toLocaleString('ko-KR') + '원'}{job.wageType ? ' · ' + ({ hourly: '시급', daily: '일급', monthly: '월급', annual: '연봉' }[job.wageType] ?? '임금 기준 확인 필요') : ''}</dd></div>
    </dl></li>)}</ul> : <p>등록한 직장이 없어요.</p>}<Link to="/injury?section=employment">직장 기록 보기</Link></details>
    <nav className="reemployment-links" aria-label="재취업 관련 기록"><Link to="/injury?section=employment">직장 기록<Icon name="chevron-right"/></Link><Link to="/injury?section=payments">지급장부<Icon name="chevron-right"/></Link><Link to="/injury?section=claim">산재·요양 기록<Icon name="chevron-right"/></Link><Link to="/injury?section=tasks">준비할 일<Icon name="chevron-right"/></Link></nav>
    <details className="advisor-materials"><summary>새 직장에서 증상이 심해졌다면</summary><EditableGuidance data={data} reload={reload} contentKey="reemployment-worsening" title="증상 악화 시 확인할 내용" fallback={WORSENING}>{paragraphs}</EditableGuidance></details>
    <details className="advisor-materials"><summary>회사에 산재 이력을 알려야 하나요?</summary><EditableGuidance data={data} reload={reload} contentKey="reemployment-privacy" title="채용과 건강정보 확인" fallback={PRIVACY}>{paragraphs}</EditableGuidance></details>
    <details className="advisor-materials reemployment-sources"><summary>공식 안내</summary><a href="https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1031640479" target="_blank" rel="noreferrer">부분휴업급여 · 산재보험법 제53조</a><a href="https://www.law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joBrNo=00&joNo=0049&lsiSeq=287491&urlMode=lsScJoRltInfoR" target="_blank" rel="noreferrer">지급요건 · 시행령 제49조</a><a href="https://law.go.kr/LSW/lumLsLinkPop.do?chrClsCd=010202&lspttninfSeq=113635" target="_blank" rel="noreferrer">청구자료 · 시행규칙 제44조</a><a href="https://m.work24.go.kr/cm/c/f/1100/selecSystInfo.do?currentPageNo=1&recordCountPerPage=9&systClId=SC00000254&systId=SI00000411&upprSystClId=" target="_blank" rel="noreferrer">고용24 · 취업사실 신고</a><a href="https://www.law.go.kr/LSW/lsLinkCommonInfo.do?lsJoLnkSeq=1032848779" target="_blank" rel="noreferrer">재요양 · 산재보험법 제51조</a><a href="https://www.law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=1000634115" target="_blank" rel="noreferrer">건강정보 · 개인정보보호법 제23조</a></details>
  </section>;
}
