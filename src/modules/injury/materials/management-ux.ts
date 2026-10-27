import type { LegalPolicy } from '../domain/calculations';

export const calculationModes = [
  ['work_injury', '치료 때문에 쉬는 동안 받을 돈'],
  ['unemployment', '퇴사 후 받을 구직급여'],
  ['insurance_window', '실업급여에 필요한 일수'],
  ['simulation', '다른 직장에서 더 일한다면'],
  ['payroll', '덜 받은 수당이 있는지'],
  ['severance', '퇴직금과 남은 연차'],
] as const;
export const calculationHelp: Record<string, string> = {
  work_injury: '하루 평균임금과 실제로 일하지 못한 날을 확인해요. 치료받은 기간 전체를 그대로 넣지는 마세요.',
  unemployment: '고용센터에서 확인한 날짜 수와 임금 자료가 필요해요. 아직 모르는 값은 추측해서 넣지 않아도 돼요.',
  insurance_window: '저장된 직장·유급일 기록을 함께 살펴봐요. 재직한 달력 일수와 실업급여에 쓰는 유급 일수는 따로 보여줘요.',
  simulation: '생각 중인 입사일·퇴사일과 유급 요일을 넣어 보세요. 실제 직장 이력은 바뀌지 않아요.',
  payroll: '급여명세서에서 시급·추가 근무시간·이미 받은 수당을 확인해요.',
  severance: '일한 기간과 확인한 임금으로 예상해요. 연차는 회사가 확인한 내역과 대조해 주세요.',
};
export function applicablePolicies(policies: LegalPolicy[], date: string): LegalPolicy[] {
  return policies.filter(p=>p.status==='effective' && p.effectiveFrom<=date && p.effectiveTo>=date && /^https:\/\//.test(p.sourceUrl));
}
export function calculationError(error: unknown): string {
  const code=error instanceof Error?error.message:'';
  const messages:Record<string,string>={
    VERIFIED_POLICY_REQUIRED:'선택한 날짜에 적용할 계산 근거를 확인하지 못했어요. 날짜나 아래 계산 기준을 확인해 주세요.',
    INVALID_INPUT:'입력한 금액·일수·시간을 확인해 주세요. 아직 모르는 값은 자료를 확인한 뒤 계산해도 돼요.',
    INVALID_DATE:'날짜를 다시 확인해 주세요.',
    INVALID_PERIOD:'마지막 근무일이 입사일보다 빠르지 않은지 확인해 주세요.',
    INVALID_WINDOW:'저장된 계산 기준을 확인해야 해요. 지금은 일수를 계산할 수 없어요.',
    EXCEPTION_EVIDENCE_REQUIRED:'예외를 적용하려면 확인한 원본 자료가 필요해요.',
    INVALID_EXTENSION:'확인한 무급기간과 적용할 예외를 다시 확인해 주세요.',
    SIMULATION_RANGE_TOO_LONG:'계산할 기간이 너무 길어요. 입사일과 마지막 근무일을 좁혀 주세요.',
  };
  return messages[code] ?? (/^[A-Z_]+$/.test(code)?'계산하지 못했어요. 입력값과 근거 자료를 확인해 주세요.':code||'계산하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
}
const moneyKeys=new Set(['amount','dailyRate','unpaidEstimate','estimatedAmount','outstandingEstimate']);
const dayKeys=new Set(['documentedDays','estimatedDays','missingDocumentedDays','simulatedPaidDays','previousDaysExpired','tenureCalendarDays','calendarDays','insuredCalendarDays','available','accrualEstimate']);
export function calculationValue(key:string,value:unknown):string {
  if(value===null||value===undefined)return '아직 계산할 수 없어요';
  if(typeof value==='boolean')return value?'해당해요':'해당하지 않아요';
  if(Array.isArray(value))return value.join(', ')||'없어요';
  if(typeof value==='number')return value.toLocaleString('ko-KR')+(moneyKeys.has(key)?'원':dayKeys.has(key)?'일':'');
  const status:Record<string,string>={estimate:'입력한 내용으로 계산한 예상',agency_review:'기관에 확인한 뒤 계산할 수 있어요',hours_review:'근무시간에 맞는 계산 기준을 먼저 확인해요',review_required:'근로조건과 증빙을 먼저 확인해요'};
  return status[String(value)]??String(value);
}

export const tracksPaymentDays=(benefitType:unknown)=>['workers_comp_leave','unemployment'].includes(String(benefitType));
/** Legacy ledger zero cannot distinguish an omitted day count from an explicit
 * zero. Keep that uncertainty in the UI; never rewrite the immutable events. */
export function paymentDayDisplay(data:Record<string,unknown>,events:ReadonlyArray<{event_type:string;recognized_days:number}>,totals:{recognizedDays:number;remainingDays:number|null}){
  const applicable=tracksPaymentDays(data.benefitType);
  const decisions=events.filter(e=>['decision','decision_adjustment'].includes(e.event_type));
  const hasDayEvidence=decisions.length>0&&decisions.every(e=>e.recognized_days!==0);
  const hasExplicitRemaining=typeof data.officialRemainingDays==='number';
  return {
    applicable,
    recognizedDays:applicable&&hasDayEvidence?totals.recognizedDays:null,
    remainingDays:applicable&&(hasDayEvidence||hasExplicitRemaining)?totals.remainingDays:null,
  };
}
