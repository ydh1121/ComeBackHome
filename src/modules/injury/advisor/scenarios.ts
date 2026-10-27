import type { CasePayload, CaseRecord } from '../domain/records';
import type { CaseData } from '../ui/types';
import { addDays, todaySeoul, validDate } from '../domain/dates';
import { HOSPITAL_SCRIPT, profileId, readProfile } from './model';

export interface Scenario {
  id: string;
  category: string;
  title: string;
  reason: string;
  recipient: string;
  steps: string[];
  materials: string[];
  script: string;
  question: string;
  options: readonly (readonly [string, string, string?])[];
  caution: string;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'A', category: '병원 진료', title: '지금 하는 일을 계속해도 괜찮은지 물어보세요',
    reason: '치료와 회사에 요청할 업무 조정을 정하려면 의사의 의견이 필요해요.', recipient: '진료를 보는 의사',
    steps: ['어디가 아픈지, 어떤 작업을 할 때 힘든지 설명하세요.', '검사가 필요한지, 피하거나 줄일 작업이 있는지 물어보세요.', '검사 비용과 진료기록 발급 방법을 확인하세요.'],
    materials: ['하는 일과 불편한 증상을 적은 메모', '이전에 받은 검사 결과가 있다면 함께 준비'], script: HOSPITAL_SCRIPT,
    question: '진료 때 어떤 설명을 들었나요?', options: [['exam', '검사가 필요하다고 했어요', 'B'], ['restriction', '쉬거나 일을 줄이라고 했어요', 'C'], ['unclear', '일을 해도 되는지는 못 물어봤어요', 'B']],
    caution: '검사를 권유받은 것과 진단이 확정된 것은 달라요.',
  },
  {
    id: 'B', category: '진료 후 확인', title: '줄여야 할 작업이 있는지 확인하세요',
    reason: '회사에 업무 조정을 요청할 때는 의사가 실제로 설명한 내용이 필요해요.', recipient: '진료를 보는 의사',
    steps: ['무겁거나 반복되는 작업을 구체적으로 설명하세요.', '계속해도 되는 작업과 피해야 할 작업을 물어보세요.', '검사를 권유받았다면 필요성·비용·결과 확인일을 물어보세요.'],
    materials: ['진료기록이나 검사 안내문', '실제로 하는 작업을 적은 메모'],
    script: '제가 하는 작업 중 줄이거나 피해야 할 일이 있는지 알고 싶습니다. 일을 쉬어야 한다면 어느 정도 기간이 필요한가요? 검사가 필요하다면 이유와 비용, 결과를 확인할 날짜도 알려주세요.',
    question: '업무에 대해 어떤 답을 들었나요?', options: [['restriction', '쉬거나 일을 줄이라고 했어요', 'C'], ['no_restriction', '일을 해도 된다고 했어요', 'D'], ['unclear', '아직 설명을 못 들었어요']],
    caution: '의사가 말하지 않은 진단명이나 휴식 기간을 대신 정하지 않아요.',
  },
  {
    id: 'C', category: '회사에 문의', title: '업무 조정이나 병가가 가능한지 물어보세요',
    reason: '회사에서 가능한 방법을 알아두면 치료와 근무 계획을 함께 정할 수 있어요.', recipient: '회사 담당자',
    steps: ['어떤 작업이 힘든지 설명하고 조정을 요청하세요.', '병가나 휴직이 가능한지, 기간은 얼마나 되는지 물어보세요.', '대화 후 문자로 답변을 남겨두세요.'],
    materials: ['업무 제한에 대한 의사의 실제 설명', '회사에 문의한 문자와 답변'],
    script: '현재 하는 업무 중 몸에 부담이 되는 작업이 있어 상담을 요청드립니다. 당분간 작업을 조정하거나 병가·휴직을 사용할 수 있을까요? 가능한 방법과 기간을 알려주세요.',
    question: '회사에서 뭐라고 했나요?', options: [['allowed', '가능하다고 했어요', 'D'], ['refused', '어렵다고 했어요', 'D'], ['waiting', '아직 답이 없어요']],
    caution: '회사의 답변만으로 퇴사 사유나 실업급여 수급 여부가 결정되지는 않아요.',
  },
  {
    id: 'D', category: '산재 신청 준비', title: '병원에서 산재 신청을 접수해 주는지 확인하세요',
    reason: '신청을 대신 접수하는 것과 다른 곳을 소개해 주는 것은 달라요.', recipient: '병원 산재 담당자',
    steps: ['병원에서 직접 신청서를 보내는지 물어보세요.', '내가 따로 준비할 서류가 있는지 확인하세요.', '보냈다면 접수일과 접수번호를 요청하세요.'],
    materials: ['진료기록과 검사 결과', '업무 내용과 증상 발생 경위를 적은 메모'],
    script: '산재 신청을 병원에서 직접 접수해 주시나요, 아니면 다른 곳을 연결해 주시나요? 제가 준비할 서류가 있으면 알려주세요. 이미 접수했다면 접수일과 접수번호를 확인하고 싶습니다.',
    question: '접수에 대해 어떤 답을 들었나요?', options: [['filed', '공단에 보냈다고 했어요', 'E'], ['preparing', '병원에서 준비 중이에요'], ['self', '제가 직접 신청해야 해요']],
    caution: '병원에 문의한 것만으로 공단 접수가 끝난 것은 아니에요.',
  },
  {
    id: 'E', category: '접수 확인', title: '공단 접수번호를 확인하세요',
    reason: '문자를 받지 못했어도 접수 여부를 확인할 수 있어요.', recipient: '근로복지공단 담당 지사',
    steps: ['접수일과 접수번호를 물어보세요.', '담당 지사와 담당자 연락처를 확인하세요.', '추가로 제출할 자료가 있는지 물어보세요.'],
    materials: ['신청서를 보낸 날짜', '접수증이나 병원의 접수 안내'],
    script: '산재 신청이 접수됐는지 확인하고 싶습니다. 접수번호와 접수일, 담당 지사와 담당자를 알려주세요. 추가로 내야 하는 자료도 있나요?',
    question: '접수 여부를 확인했나요?', options: [['received', '공단 접수번호를 받았어요', 'F'], ['waiting', '아직 확인 중이에요'], ['missing', '접수되지 않았다고 했어요', 'D']],
    caution: '문자가 없다는 이유만으로 미접수 상태로 바꾸지 않아요.',
  },
  {
    id: 'F', category: '공단 조사', title: '추가로 필요한 자료와 제출일을 확인하세요',
    reason: '공단이 요청한 자료부터 준비하면 조사에 필요한 내용을 빠뜨리지 않을 수 있어요.', recipient: '근로복지공단 담당자',
    steps: ['현재 진행 단계와 추가로 필요한 자료를 물어보세요.', '회사 의견과 다른 부분은 사실과 자료로 설명하세요.', '제출 방법과 기한을 확인하세요.'],
    materials: ['실제 작업 내용과 진료자료', '공단의 요청문과 회사 답변'],
    script: '산재 조사가 현재 어디까지 진행됐는지 알고 싶습니다. 추가로 필요한 자료와 제출 기한을 알려주세요. 회사 의견과 제 설명이 다른 부분은 어떤 자료로 설명하면 될까요?',
    question: '공단에서 어떤 안내를 받았나요?', options: [['supplement', '추가 자료를 요청받았어요'], ['waiting', '결과를 기다리라고 했어요'], ['decision', '결과가 나왔다고 했어요', 'G']],
    caution: '회사에서 반대했다는 이유만으로 산재가 불승인되는 것은 아니에요.',
  },
  {
    id: 'G', category: '심사 결과', title: '결정문에서 결과와 인정 기간을 확인하세요',
    reason: '문자만으로는 인정된 병명과 기간, 지급 내용을 모두 알기 어려워요.', recipient: '근로복지공단 담당자',
    steps: ['결정문을 받지 못했다면 발급 방법을 물어보세요.', '결정문에 적힌 결과와 병명, 기간을 확인하세요.', '일부 승인이나 불승인이라면 이유와 이의 제기 절차를 물어보세요.'],
    materials: ['공단 결정문', '결과를 알게 된 날짜와 받은 문자'],
    script: '산재 심사 결과에 대한 결정문을 확인하고 싶습니다. 인정된 병명과 기간을 설명해 주세요. 인정되지 않은 부분이 있다면 그 이유와 이의 제기 방법, 기한도 알려주세요.',
    question: '결정문을 받았나요?', options: [['document', '받아서 내용을 확인했어요', 'J'], ['sms', '문자만 받았어요'], ['requested', '결정문을 요청했어요']],
    caution: '결정문을 읽었다는 답변만으로 승인 여부나 지급액을 확정하지 않아요.',
  },
  {
    id: 'H', category: '치료 기간 연장', title: '치료를 더 받아야 하는지 병원에 문의하세요',
    reason: '치료가 더 필요하면 병원에서 진료계획서를 준비하고 공단 접수 여부를 확인해야 해요.', recipient: '주치의 또는 병원 산재 담당자',
    steps: ['현재 승인된 치료 종료일을 확인하세요.', '치료가 더 필요한지 주치의에게 물어보세요.', '병원에서 진료계획서를 보냈는지, 공단에 접수됐는지 확인하세요.'],
    materials: ['현재 요양 승인 결정문', '진료계획서 제출·접수 안내'],
    script: '승인된 요양기간과 앞으로 필요한 치료를 확인하고 싶습니다. 치료를 더 받아야 한다면 병원에서 진료계획서를 제출했는지, 공단에 접수됐는지도 알려주세요.',
    question: '병원에서 어디까지 진행했다고 했나요?', options: [['consult', '주치의와 상담할 예정이에요'], ['submitted', '병원에서 제출했다고 했어요'], ['received', '공단 접수까지 확인했어요']],
    caution: '연장 신청과 승인은 달라요. 날짜가 지났더라도 병원이나 공단에 바로 문의하세요.',
  },
  {
    id: 'I', category: '먼저 낸 병원비', title: '어떤 치료비를 청구할 수 있는지 확인하세요',
    reason: '직접 낸 비용 중 산재로 청구할 수 있는 항목은 공단 확인이 필요해요.', recipient: '근로복지공단 담당자',
    steps: ['영수증과 진료비 세부내역서를 모으세요.', '실손보험 등에서 이미 받은 금액이 있는지 확인하세요.', '청구할 수 있는 항목과 필요한 서류를 물어보세요.'],
    materials: ['진료비·약제비 영수증', '진료비 세부내역서와 보험금 지급내역'],
    script: '제 돈으로 낸 진료비와 검사비가 있습니다. 어떤 항목을 요양비로 청구할 수 있는지 확인하고 싶습니다. 이미 받은 보험금이 있을 때의 처리 방법과 필요한 서류도 알려주세요.',
    question: '청구에 대해 어디까지 확인했나요?', options: [['receipts', '영수증을 준비했어요'], ['checked', '청구할 항목을 안내받았어요'], ['filed', '청구 서류를 제출했어요']],
    caution: '비급여 비용이 모두 환급되는 것은 아니에요. 안내받은 금액과 실제 입금은 따로 확인하세요.',
  },
  {
    id: 'J', category: '휴업급여', title: '치료 때문에 일을 못한 날짜를 확인하세요',
    reason: '치료를 승인받은 기간과 일을 못한 것으로 인정받는 기간은 다를 수 있어요.', recipient: '근로복지공단 담당자',
    steps: ['실제로 일하지 못한 날짜를 구분하세요.', '그 기간에 일했거나 급여를 받은 날도 확인하세요.', '휴업급여 청구에 필요한 서류와 인정 기간을 물어보세요.'],
    materials: ['요양 승인 결정문과 의료진 소견', '실제 근무·급여 내역'],
    script: '산재 치료 때문에 실제로 일하지 못한 기간에 대해 문의드립니다. 휴업급여를 청구하려면 어떤 서류가 필요한가요? 근무하거나 임금을 받은 날은 어떻게 알려드리면 될까요?',
    question: '휴업급여는 어디까지 진행했나요?', options: [['checking', '일하지 못한 날짜를 확인 중이에요'], ['filed', '청구 서류를 제출했어요'], ['decision', '지급 결정 안내를 받았어요']],
    caution: '여기서 답을 골라도 급여가 청구되거나 지급액이 확정되지는 않아요.',
  },
  {
    id: 'K', category: '퇴사·실업급여', title: '몸 상태에 맞는 신청 시기를 문의하세요',
    reason: '퇴사 사유와 고용보험 이력, 구직활동이 가능한 상태인지 함께 확인해야 해요.', recipient: '고용센터 담당자',
    steps: ['퇴사 여부와 실제 사유를 설명하세요.', '실업급여를 계산하는 유급 일수와 필요한 서류를 물어보세요.', '지금 구직활동이 어렵다면 신청 시기와 수급기간 연장을 문의하세요.'],
    materials: ['고용보험 이력과 이직확인서', '현재 몸 상태에 대한 의료진 의견'],
    script: '제 고용보험 이력으로 수급 요건을 충족하는지 확인하고 싶습니다. 필요한 사업장별 이직확인서와 유급 일수를 알려주세요. 몸 상태로 구직활동이 어렵다면 신청 시기나 수급기간 연장을 어떻게 확인해야 하나요?',
    question: '고용센터에서 어떤 안내를 받았나요?', options: [['documents', '서류를 더 준비해야 해요'], ['timing', '신청 시기를 안내받았어요'], ['recognition', '수급자격·실업인정 안내를 받았어요']],
    caution: '재직한 달력 일수와 실업급여를 계산하는 유급 일수는 달라요. 수급 여부는 고용센터가 판단해요.',
  },
  {
    id: 'L', category: '치료가 끝난 뒤', title: '남아 있는 불편함을 주치의와 상담하세요',
    reason: '치료가 끝나도 기능에 문제가 남았다면 의료진의 평가가 필요할 수 있어요.', recipient: '치료를 담당한 주치의',
    steps: ['치료 후에도 남은 불편함을 구체적으로 설명하세요.', '장해 평가가 필요한지 물어보세요.', '필요하다면 진단서를 받을 기관과 준비할 검사자료를 확인하세요.'],
    materials: ['치료종결 관련 서류', '검사 결과와 남은 불편함을 적은 메모'],
    script: '치료가 끝난 뒤에도 남아 있는 불편함에 대해 상담하고 싶습니다. 기능장해 평가가 필요한가요? 필요하다면 장해진단서 발급기관과 준비할 검사자료를 알려주세요.',
    question: '의료진에게 어떤 설명을 들었나요?', options: [['review', '추가 평가가 필요하다고 했어요'], ['none', '장해 평가는 필요 없다고 했어요'], ['waiting', '아직 상담 전이에요']],
    caution: '치료종결만으로 장해급여를 받는 것은 아니에요.',
  },
];

export const scenario = (id: string) => SCENARIOS.find(s => s.id === id);
export const responseId = (caseId: string, id: string) => `advisor-response-v1-${caseId}-${id}`;
export const adviceScriptId = (caseId: string, id: string) => id === 'A' ? `advisor-hospital-v1-${caseId}` : `advisor-script-v1-${caseId}-${id}`;
export const responseBasis = (data: CaseData) => data.records.filter(r => !r.archivedAt && (r.kind !== 'content' || r.id === profileId(data.caseId))).map(r => `${r.id}:${r.revision}`).sort().join('|');
export interface AdviceResponse { version: 1; scenario: string; answer: string | null; deferred: boolean; basis: string; at: string }
export function readResponse(record: CaseRecord | undefined): AdviceResponse | null {
  if (!record || record.archivedAt || record.kind !== 'content' || record.payload.data.recipient !== 'advisor-response/v1') return null;
  try {
    const v = JSON.parse(record.payload.body), spec = scenario(v.scenario);
    if (v.version !== 1 || !spec || typeof v.deferred !== 'boolean' || typeof v.basis !== 'string' || typeof v.at !== 'string' || !Number.isFinite(Date.parse(v.at)) || !(v.answer === null || spec.options.some(([key]) => key === v.answer))) return null;
    return { version: 1, scenario: v.scenario, answer: v.answer, deferred: v.deferred, basis: v.basis, at: v.at };
  } catch { return null; }
}
export function responsePayload(value: AdviceResponse): CasePayload {
  return { title: `${scenario(value.scenario)!.category} 답변`, body: JSON.stringify(value), certainty: 'reported', sourceIds: [], data: { category: 'reference', medium: 'none', recipient: 'advisor-response/v1' } };
}
export function currentResponse(data: CaseData, id: string) {
  const value = readResponse(data.records.find(r => r.id === responseId(data.caseId, id)));
  return value?.scenario === id && value.basis === responseBasis(data) ? value : null;
}
export interface Advice { scenario: Scenario; priority: number; sources: string[]; due?: CaseData['deadlines'][number] }
export function recommend(data: CaseData, today = todaySeoul()): Advice[] {
  const records = data.records.filter(r => !r.archivedAt), result = new Map<string, Advice>();
  const add = (id: string, priority: number, sources: string[] = [], due?: Advice['due']) => {
    const existing = result.get(id);
    if (!existing || priority < existing.priority || (priority === existing.priority && due && (!existing.due || due.date < existing.due.date))) result.set(id, { scenario: scenario(id)!, priority, sources, ...(due ? { due } : {}) });
  };
  const profile = readProfile(records.find(r => r.id === profileId(data.caseId)));
  const intake = records.filter(r => r.kind === 'intake').sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))[0];
  const state = String(intake?.payload.data.status ?? (profile?.confirmed ? profile.answers[0] : '') ?? '');
  if (['approved', 'partial', 'denied', 'decision'].includes(state)) add('G', 30, intake ? [intake.id] : []);
  else if (['investigating', 'employer', 'committee'].includes(state)) add('F', 30, intake ? [intake.id] : []);
  else if (state === 'filed') add(intake?.payload.data.receiptNo ? 'F' : 'E', 30, intake ? [intake.id] : []);
  else if (profile?.confirmed && profile.answers[2] === 'restriction') add('C', 40);
  else if (profile?.confirmed && profile.answers[2] === 'checking') add('B', 40);
  else if (['hospital', 'preparing'].includes(state)) add('D', 45, intake ? [intake.id] : []);
  else add('A', 50);
  for (const r of records) {
    const d = r.payload.data;
    if (r.kind === 'employer_opinion' && d.status === 'disputed') add('F', 25, [r.id]);
    if (r.kind === 'agency_request' && d.status === 'supplement') add('F', 25, [r.id]);
    if (r.kind === 'treatment' && d.extensionConsidered === true && d.status !== 'ended') add('H', 35, [r.id]);
    if (r.kind === 'expense' && d.status === 'review') add('I', 45, [r.id]);
    if (r.kind === 'benefit_claim' && d.benefitType === 'workers_comp_leave' && d.status !== 'ended') add('J', 45, [r.id]);
    if ((r.kind === 'resignation' && ['left', 'agency'].includes(String(d.status))) || (r.kind === 'benefit_claim' && d.benefitType === 'unemployment' && d.status !== 'ended')) add('K', 40, [r.id]);
    if ((r.kind === 'treatment' && d.status === 'ended') || (r.kind === 'disability' && d.residual !== 'none' && d.status === 'review')) add('L', 35, [r.id]);
  }
  if (profile?.confirmed && profile.answers[1] === 'left') add('K', 40);
  const deadlineScenarios: Record<string,string> = { treatment_consult:'H', plan_prepare:'H', plan_receipt:'H', receipt_check:'E', progress_inquiry:'F', employer_reply:'F', appeal:'G', expiry:'K', benefit_prepare:'J', expense_check:'I', disability_check:'L', task:'F', appointment:'H' };
  for (const due of data.deadlines) {
    const r = records.find(r => r.id === due.recordId);
    if (!r || !validDate(due.date) || due.date > addDays(today, 14)) continue;
    const id = r.kind === 'unemployment_activity' ? 'K' : deadlineScenarios[due.action];
    if (id) add(id, due.kind === 'recommended' ? 20 : 10, [r.id], due);
  }
  // A reply guides the next conversation; it never changes a claim or medical decision.
  for (const s of SCENARIOS) {
    const reply = currentResponse(data, s.id);
    if (!reply || reply.deferred) continue;
    const next = s.options.find(([key]) => key === reply.answer)?.[2];
    if (next) {
      const previous = result.get(s.id);
      if (previous && previous.priority >= 25) previous.priority = 60;
      add(next, 32, [responseId(data.caseId, s.id)]);
    }
  }
  return [...result.values()].sort((a,b) => a.priority - b.priority || a.scenario.id.localeCompare(b.scenario.id));
}
