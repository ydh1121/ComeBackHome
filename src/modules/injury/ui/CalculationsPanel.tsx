import { useState } from "react";
import {
  estimateWorkInjury,
  estimateUnemployment,
  insuredDays,
  simulateEmployment,
  payrollEstimate,
  severanceEstimate,
  annualLeaveEstimate,
  requirePolicy,
  aggregateInsuredPeriods,
  type PaidDay,
  type InsuranceWindow,
} from "../domain/calculations";
import { todaySeoul, inclusiveDays } from "../domain/dates";
import type { CaseData } from "./types";
import { calculationModes as modes, calculationHelp, applicablePolicies, calculationError, calculationValue } from "../materials/management-ux";
import "../materials/management-ux.css";
const labels: Record<string, string> = {
  amount: "예상 총액",
  dailyRate: "예상 1일액",
  status: "판정 상태",
  documentedDays: "서류 확인 유급일",
  estimatedDays: "예상 유급일",
  ambiguousDates: "중복·충돌 날짜",
  missingDocumentedDays: "목표까지 부족한 확인일",
  start: "산정 창 시작일",
  end: "산정 창 종료일",
  firstExpectedDate: "조건부 목표 도달 예상일",
  simulatedPaidDays: "가상 직장 유급일",
  previousDaysExpired: "창에서 빠진 과거 확인일",
  weeklyHolidayNeedsReview: "유급주휴 요건 확인 필요",
  unpaidEstimate: "미지급 추정액",
  tenureCalendarDays: "달력상 재직일",
  qualifiesByEnteredFacts: "입력 조건상 요건 충족",
  estimatedAmount: "예상 퇴직금",
  outstandingEstimate: "남은 예상 정산액",
  available: "남은 연차 추정",
  accrualEstimate: "발생 연차 추정",
  expiryNeedsReview: "연차 만료 확인 필요",
  calendarDays: "달력상 재직일",
  insuredCalendarDays: "별도로 합산한 피보험기간 달력일",
  excludedBefore: "과거 구직급여로 제외하는 상실일 이전",
};
export function CalculationsPanel({ data }: { data: CaseData }) {
  const [mode, setMode] = useState<string>("work_injury"),
    [result, setResult] = useState<Record<string, unknown> | null>(null),
    [exception, setException] = useState("none"),
    [error, setError] = useState(""),
    [basisDate,setBasisDate] = useState(todaySeoul()),
    [pickedPolicy,setPickedPolicy] = useState<string|null>(null),
    [conditionsReviewed,setConditionsReviewed] = useState(false);
  const key = ["payroll", "severance"].includes(mode)
    ? "employment_pay"
    : mode === "simulation"
      ? "insurance_window"
      : mode;
  const policies = data.policies.filter(
    (p) => p.key === key && p.status === "effective",
  );
  const validPolicies=applicablePolicies(policies,basisDate);
  const policyId=pickedPolicy??(validPolicies.length===1?validPolicies[0].id:"");
  const number = (
    name: string,
    label: string,
    value?: number,
    min = 0,
    max = 100000000000,
  ) => (
    <label>
      {label}
      <input
        type="number"
        name={name}
        required
        min={min}
        max={max}
        step="any"
        defaultValue={value}
      />
    </label>
  );
  const date = (name: string, label: string, value = todaySeoul()) => (
    <label>
      {label}
      <input name={name} type="date" defaultValue={value} required onChange={e=>{if(name==="date"||name==="leave"){setBasisDate(e.target.value);setPickedPolicy(null);}setResult(null);}}/>
    </label>
  );
  const checkbox = (name: string, label: string) => (
    <label className="auth-check">
      <input name={name} type="checkbox" />
      {label}
    </label>
  );
  return (
    <details className="private-card management-estimate">
      <summary>예상금액·기간 계산</summary>
      <label>
        무엇을 알아볼까요?
        <select
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);setException("none");setPickedPolicy(null);setBasisDate(todaySeoul());setConditionsReviewed(false);
            setResult(null);
            setError("");
          }}
        >
          {modes.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <p className="management-explanation">{calculationHelp[mode]} <a href="/injury?section=today">자료 확인 방법부터 볼게요</a></p>
      <form
        key={mode}
        onChange={()=>setResult(null)}
        onInvalid={e=>{const details=(e.target as HTMLElement).closest("details.calculation-options");if(details instanceof HTMLDetailsElement)details.open=true;}}
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          setResult(null);
          const f = new FormData(e.currentTarget),
            n = (k: string) => Number(f.get(k)),
            s = (k: string) => String(f.get(k) ?? ""),
            b = (k: string) => f.get(k) === "on",
            policy = policies.find((p) => p.id === s("policy"));
          try {
            if (!policy)
              throw Error(
                "계산 기준을 아직 확인하지 못했어요. 기본 안내는 계속 볼 수 있어요.",
              );
            const paid: PaidDay[] = data.records
              .filter((r) => r.kind === "paid_day" && !r.archivedAt)
              .map((r) => ({
                date: String(r.payload.data.date),
                employmentId: String(r.payload.data.employmentId ?? ""),
                type: String(r.payload.data.dayType),
                verification: r.payload.data
                  .verification as PaidDay["verification"],
                sourceId: r.payload.data.sourceDocument
                  ? String(r.payload.data.sourceDocument)
                  : undefined,
              }));
            let out: Record<string, unknown>;
            if (mode === "work_injury")
              out = estimateWorkInjury(
                {
                  date: s("date"),
                  averageDailyWage: n("average"),
                  incapacityDays: n("days"),
                  partialWork: b("partial"),
                  specialCase: b("special"),
                },
                policy,
              );
            else if (mode === "unemployment")
              out = estimateUnemployment(
                {
                  date: s("date"),
                  averageDailyWage: n("average"),
                  ordinaryDailyWage: n("ordinary"),
                  dailyWorker: b("dailyWorker"),
                  specialBasis: b("specialBasis"),
                  scheduledDailyHours: n("hours"),
                  allocatedDays: n("days"),
                },
                policy,
              );
            else if (mode === "insurance_window" || mode === "simulation") {
              requirePolicy(policy, "insurance_window", s("leave"), [
                "months",
                "requiredDays",
                "maxMonths",
              ]);
              const pastBenefitLost = data.records
                .filter(
                  (r) =>
                    r.kind === "employment" &&
                    !r.archivedAt &&
                    r.payload.data.actualOrSimulated === "actual" &&
                    r.payload.data.previousBenefitsUsed === true &&
                    r.payload.data.insuredLost,
                )
                .map((r) => String(r.payload.data.insuredLost))
                .sort()
                .at(-1);
              const window: InsuranceWindow = {
                months: policy.values.months,
                requiredDays: policy.values.requiredDays,
                maxMonths: policy.values.maxMonths,
                priorBenefitLostDate: pastBenefitLost,
              };
              if (mode === "insurance_window" && exception !== "none") {
                const source = data.documents.find(
                  (d) => d.id === s("exceptionSource") && d.status === "ready",
                );
                if (!source)
                  throw Error("예외 요건을 확인한 원본 문서를 선택해 주세요.");
                window.exceptionEvidence = source.id;
                if (exception === "illness_unpaid") {
                  if (!b("continuous"))
                    throw Error(
                      "계속된 무급기간과 연장 사유를 먼저 확인해 주세요.",
                    );
                  window.exceptionKind = "illness_unpaid";
                  window.extensionDays = n("extensionDays");
                } else {
                  if (!b("shortConfirmed"))
                    throw Error("단시간 예외의 세 요건을 확인해 주세요.");
                  window.exceptionKind = "short_hours";
                  window.months = 24;
                }
              }
              if (mode === "insurance_window")
                out = {
                  ...insuredDays(paid, s("leave"), window),
                  calendarDays: inclusiveDays(s("hire"), s("leave")),
                  excludedBefore: pastBenefitLost ?? "없음",
                  ...aggregateInsuredPeriods(
                    data.records
                      .filter(
                        (r) =>
                          r.kind === "employment" &&
                          !r.archivedAt &&
                          r.payload.data.actualOrSimulated === "actual" &&
                          r.payload.data.insuredFrom &&
                          r.payload.data.insuredLost &&
                          r.payload.sourceIds.length > 0 &&
                          r.payload.certainty !== "reported" &&
                          r.payload.certainty !== "estimated",
                      )
                      .map((r) => ({
                        from: String(r.payload.data.insuredFrom),
                        lost: String(r.payload.data.insuredLost),
                        previousBenefitsUsed:
                          r.payload.data.previousBenefitsUsed === true,
                      })),
                    s("leave"),
                  ),
                };
              else
                out = simulateEmployment(
                  {
                    previous: paid,
                    hireDate: s("hire"),
                    leaveDate: s("leave"),
                    paidWeekdays: f.getAll("weekday").map(Number),
                    unpaidDates: s("unpaid")
                      .split(",")
                      .map((v) => v.trim())
                      .filter(Boolean),
                    extraPaidDates: s("extra")
                      .split(",")
                      .map((v) => v.trim())
                      .filter(Boolean),
                    weeklyHolidayVerified: b("holiday"),
                  },
                  window,
                );
            } else if (mode === "payroll")
              out = payrollEstimate(
                {
                  date: s("date"),
                  hourlyRate: n("hourly"),
                  overtimeHours: n("overtime"),
                  nightHours: n("night"),
                  paidOvertime: n("paidOvertime"),
                  paidNight: n("paidNight"),
                  employeeCount: n("employees"),
                  statementVerified: b("verified"),
                },
                policy,
              );
            else
              out = {
                ...severanceEstimate(
                  {
                    hireDate: s("hire"),
                    leaveDate: s("leave"),
                    weeklyHours: n("weekly"),
                    averageDailyWage: n("average"),
                    ordinaryDailyWage: n("ordinary"),
                    paid: n("paid"),
                  },
                  policy,
                ),
                ...annualLeaveEstimate(
                  {
                    hireDate: s("hire"),
                    leaveDate: s("leave"),
                    weeklyHours: n("weekly"),
                    employeeCount: n("employees"),
                    attendancePercent: n("attendance"),
                    fullAttendanceMonths: n("months"),
                    granted: s("granted") === "" ? null : n("granted"),
                    used: n("used"),
                    paid: n("paidLeave"),
                  },
                  policy,
                ),
              };
            setResult(out);
          } catch (err) {
            setError(calculationError(err));
          }
        }}
      >
        <details className="calculation-basis" open={!policyId&&policies.length>0}>
          <summary>계산 기준 확인</summary>
          {policyId&&<p className="management-explanation">{basisDate}에 적용할 근거를 선택했어요. 실제 지급 여부는 기관의 결정과 달라요.</p>}
          <label>적용할 근거<select name="policy" aria-label="계산 근거" value={policyId} onChange={e=>{setPickedPolicy(e.target.value);setResult(null);}} required><option value="">맞는 근거를 확인해 주세요</option>{policies.map(p=><option key={p.id} value={p.id}>{p.version} · {p.effectiveFrom} ~ {p.effectiveTo}</option>)}</select></label>
          {validPolicies.length>1&&<p className="management-explanation">이 날짜에 적용할 근거가 여러 개예요. 어느 근거가 맞는지 확인한 뒤 선택해 주세요.</p>}
        </details>
        {!policies.length&&<p className="management-explanation" role="status">아직 계산 근거가 준비되지 않았어요. 숫자를 입력하지 않아도 도우미 안내와 자료 보관은 이용할 수 있어요.</p>}
        {!!policies.length&&!validPolicies.length&&<p className="management-explanation" role="status">선택한 날짜에 맞는 계산 근거가 없어요. 날짜나 계산 기준을 먼저 확인해 주세요.</p>}
        <fieldset disabled={!policies.length} className="calculation-inputs">
        <div className="field-grid">
          {["work_injury", "unemployment", "payroll"].includes(mode) &&
            date("date", "계산 기준일")}
          {["work_injury", "unemployment", "severance"].includes(mode) &&
            number("average", "확인한 하루 평균임금 (원)")}
          {mode === "work_injury" && (
            <>
              {number("days", "실제로 일하지 못한 날짜 수", undefined, 0, 1500)}
              <details className="calculation-options"><summary>이런 경우가 있나요?</summary><div className="field-grid">{checkbox("partial", "이 기간에 일을 하거나 임금을 받은 날이 있어요")}{checkbox("special", "별도의 적용 기준을 확인해야 해요")}</div></details>
            </>
          )}
          {mode === "unemployment" && (
            <>
              {number("ordinary", "확인한 하루 통상임금 (원)")}
              {number("hours", "계약상 하루 근무시간", 8, 1, 8)}
              {number("days", "고용센터가 정한 날짜 수", undefined, 0, 500)}
              <details className="calculation-options"><summary>근무 형태·추가 확인</summary><div className="field-grid">{checkbox("dailyWorker", "마지막 직장에서 일용근로자로 일했어요")}{checkbox("specialBasis", "반복 취업 등으로 별도 계산 기준을 확인해야 해요")}</div></details>
            </>
          )}
          {["insurance_window", "simulation", "severance"].includes(mode) && (
            <>
              {date("hire", "입사일")}
              {date("leave", "마지막 근무일")}
            </>
          )}
          {mode === "simulation" && (
            <>
              <fieldset>
                <legend>주휴를 포함해 유급인 요일</legend>
                <div className="weekday-options">
                  {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
                    <label key={d}>
                      <input type="checkbox" name="weekday" value={i} />
                      {d}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label>
                따로 임금을 받지 않는 날 (쉼표로 구분)
                <input name="unpaid" placeholder="YYYY-MM-DD, YYYY-MM-DD" />
              </label>
              <label>
                따로 임금을 받는 날 (쉼표로 구분)
                <input name="extra" />
              </label>
              {checkbox("holiday", "선택한 유급주휴의 실제 발생 요건을 확인함")}
            </>
          )}
          {mode === "insurance_window" && (
            <>
              <label>
                기관에서 기간 예외를 확인했나요?
                <select
                  value={exception}
                  onChange={(e) => {
                    setException(e.target.value);
                    setResult(null);
                  }}
                >
                  <option value="none">일반 기준기간</option>
                  <option value="illness_unpaid">
                    질병·부상 등 계속된 무급기간 연장
                  </option>
                  <option value="short_hours">단시간근로 24개월 예외</option>
                </select>
              </label>
              {exception !== "none" && (
                <label>
                  예외 근거 원본
                  <select name="exceptionSource" required>
                    <option value="">문서 선택</option>
                    {data.documents
                      .filter((d) => d.status === "ready")
                      .map((d) => (
                        <option value={d.id} key={d.id}>
                          {d.filename}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {exception === "illness_unpaid" && (
                <>
                  {number(
                    "extensionDays",
                    "확인된 무급기간 일수",
                    undefined,
                    30,
                    1096,
                  )}
                  {checkbox(
                    "continuous",
                    "기준기간 내 30일 이상 계속된 무급기간이며 법정 연장 사유에 해당함을 확인",
                  )}
                </>
              )}
              {exception === "short_hours" &&
                checkbox(
                  "shortConfirmed",
                  "이직 당시 주 15시간 미만·주 2일 이하이며, 이전 24개월 중 해당 근로일 90일 이상을 확인",
                )}
            </>
          )}
          {mode === "payroll" && (
            <>
              {number("hourly", "확인한 시급 (원)")}
              <details className="calculation-options"><summary>추가 근무·이미 받은 수당 확인</summary><div className="field-grid">
              {number("overtime", "법정 연장 시간", 0, 0, 744)}
              {number("night", "야간 시간", 0, 0, 744)}
              {number("paidOvertime", "이미 받은 연장수당", 0)}
              {number("paidNight", "이미 받은 야간수당", 0)}
              {number("employees", "상시근로자 수", 5)}
              {checkbox("verified", "급여명세서에 포함된 수당을 확인했어요")}
              </div></details>
            </>
          )}
          {mode === "severance" && (
            <>
              {number("ordinary", "확인한 하루 통상임금 (원)")}
              <details className="calculation-options"><summary>근무 조건·이미 받은 퇴직금·연차 확인</summary><div className="field-grid">
              {number("weekly", "계약상 한 주 근무시간 (4주 평균)", 40, 0, 168)}
              {number("paid", "이미 받은 퇴직금", 0)}
              {number("employees", "상시근로자 수", 5)}
              {number("attendance", "출근율 %", 100, 0, 100)}
              {number("months", "1년 미만 개근 월수", 0, 0, 11)}
              <label>
                회사 확인 발생 연차 (선택)
                <input type="number" name="granted" min={0} max={100} />
              </label>
              {number("used", "사용 연차", 0, 0, 100)}
              {number("paidLeave", "이미 정산한 연차", 0, 0, 100)}
              </div></details>
            </>
          )}
        </div>
        </fieldset>
        {["payroll","severance"].includes(mode)&&<label className="auth-check calculation-confirm"><input type="checkbox" checked={conditionsReviewed} onChange={e=>setConditionsReviewed(e.target.checked)}/>추가 조건을 열어 실제 근무시간·인원·정산 내역을 확인했어요</label>}
        <button disabled={!policies.length||!policyId||(["payroll","severance"].includes(mode)&&!conditionsReviewed)}>예상 계산</button>
        <p role="alert">{error}</p>
      </form>
      {result && (
        <section className="calculation-result" aria-live="polite">
          <h3>입력값 기준 예상</h3>
          <dl>
            {Object.entries(result)
              .filter(([k]) => labels[k])
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{labels[k]}</dt>
                  <dd>
                    {calculationValue(k,v)}
                  </dd>
                </div>
              ))}
          </dl>
          <p>
            기관의 수급자격·지급결정과 별개입니다. 근거가 없는 날짜를 유급일로
            자동 확정하지 않습니다.
          </p>
          {Array.isArray(result.milestones) && (
            <>
              <h4>피보험기간 목표 (잠정)</h4>
              {(
                result.milestones as Array<{
                  years: number;
                  remainingCalendarDays: number;
                }>
              ).map((m) => (
                <p key={m.years}>
                  {m.years}년 기준까지 약 {m.remainingCalendarDays}일
                </p>
              ))}
              <p>
                원본이 연결된 실제 직장 이력만 사용합니다. 윤년·중복·과거 수급
                내역에 따른 기관 산정과 대조해야 하며, 180 유급일 요건과
                별개입니다.
              </p>
            </>
          )}
        </section>
      )}
    </details>
  );
}
