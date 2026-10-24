import { validDate, inclusiveDays } from "./dates";
export type FieldType =
  | "text"
  | "long"
  | "date"
  | "number"
  | "select"
  | "boolean";
export interface Field {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  min?: number;
  max?: number;
  options?: readonly (readonly [string, string])[];
}
export interface RecordSpec {
  title: string;
  group: "tasks" | "claim" | "employment" | "payments" | "documents";
  fields: readonly Field[];
  officialStates?: readonly string[];
}
const text = (key: string, label: string, required = false): Field => ({
  key,
  label,
  type: "text",
  required,
});
const date = (key: string, label: string, required = false): Field => ({
  key,
  label,
  type: "date",
  required,
});
const num = (
  key: string,
  label: string,
  min = 0,
  max = 100000000000,
): Field => ({ key, label, type: "number", min, max });
const bool = (key: string, label: string): Field => ({
  key,
  label,
  type: "boolean",
});
const select = (
  key: string,
  label: string,
  options: readonly (readonly [string, string])[],
): Field => ({ key, label, type: "select", options, required: true });
const status = (options: readonly (readonly [string, string])[]) =>
  select("status", "상태", options);
const fromTo = [date("from", "시작일"), date("to", "종료일")];
const employer = text("employmentId", "직장 기록 ID");
const money = [
  num("expectedAmount", "예상금액"),
  num("requestedAmount", "청구금액"),
];
export const RECORD_SPECS = {
  content: {
    title: "안내·메시지",
    group: "documents",
    fields: [
      select("category", "종류", [
        ["guide", "안내"],
        ["message", "전달할 메시지"],
        ["contact", "기관 연락처"],
        ["reference", "참고자료"],
        ["glossary", "용어 설명"],
      ]),
      text("recipient", "전달 대상"),
      select("medium", "전달 방법", [
        ["none", "해당 없음"],
        ["spoken", "말로"],
        ["message", "문자·메신저"],
        ["document", "서면"],
      ]),
      text("phone", "전화번호"),
      text("url", "공식 주소"),
      date("checkedAt", "확인일"),
    ],
  },
  task: {
    title: "할 일·기한",
    group: "tasks",
    fields: [
      status([
        ["todo", "할 일"],
        ["waiting", "대기"],
        ["done", "완료"],
        ["cancelled", "취소"],
      ]),
      date("dueDate", "기한"),
      select("deadlineKind", "기한 구분", [
        ["recommended", "권장일"],
        ["official", "기관 지정일"],
        ["legal", "법정기한 확인 필요"],
      ]),
      text("responsible", "담당 기관·사람"),
      text("relatedId", "연결 기록 ID"),
      date("doneAt", "완료일"),
    ],
  },
  intake: {
    title: "산재 접수·조사·결정",
    group: "claim",
    officialStates: ["approved", "partial", "denied"],
    fields: [
      status([
        ["preparing", "접수 전"],
        ["filed", "접수 확인"],
        ["investigating", "공단 조사"],
        ["employer", "사업주 의견"],
        ["committee", "질병판정·보완"],
        ["approved", "승인"],
        ["partial", "일부 승인"],
        ["denied", "불승인"],
      ]),
      select("caseType", "재해 유형", [
        ["disease", "업무상 질병"],
        ["accident", "사고"],
        ["unknown", "확인 중"],
      ]),
      text("receiptNo", "접수번호"),
      date("filedAt", "접수일"),
      text("agency", "담당 지사"),
      text("caseworker", "담당자"),
      text("phone", "연락처"),
      bool("delegationConfirmed", "병원 실제 접수대행 확인"),
      bool("smsReceived", "문자 수신"),
      date("decisionAt", "결정일"),
      date("knownAt", "결정을 안 날"),
      text("diagnosis", "공식 승인 상병"),
      ...fromTo,
    ],
  },
  employer_opinion: {
    title: "사업주 의견·회사 요청",
    group: "tasks",
    fields: [
      employer,
      status([
        ["draft", "작성 중"],
        ["sent", "요청함"],
        ["allowed", "가능하다는 답변"],
        ["refused", "불가 답변"],
        ["no_response", "답변 없음"],
        ["disputed", "신청과 다른 의견"],
        ["closed", "폐업"],
        ["omitted", "서면 생략"],
      ]),
      text("topic", "요청 내용"),
      text("recipient", "전달 대상"),
      date("sentAt", "요청일"),
      date("notifiedAt", "의견 요청 통지일"),
      date("replyAt", "답변일"),
      bool("extensionConfirmed", "공단의 1회 연장 확인"),
      { key: "reply", label: "실제 답변", type: "long" },
    ],
  },
  agency_request: {
    title: "서류·기관 회신",
    group: "documents",
    fields: [
      status([
        ["needed", "필요"],
        ["requested", "요청"],
        ["received", "발급·수령"],
        ["submitted", "제출"],
        ["filed", "접수"],
        ["supplement", "보완 요구"],
        ["done", "완료"],
      ]),
      text("agency", "발급·회신 기관"),
      text("recipient", "제출처"),
      text("documentType", "필요 서류"),
      date("requestedAt", "요청일"),
      date("dueDate", "제출 기한"),
      date("receivedAt", "회신일"),
      text("receiptNo", "접수번호"),
      { key: "reply", label: "회신·보완 내용", type: "long" },
    ],
  },
  treatment: {
    title: "요양·진료계획·연장",
    group: "claim",
    officialStates: ["approved", "shortened", "ended"],
    fields: [
      status([
        ["pending", "승인 확인 중"],
        ["approved", "요양 승인"],
        ["shortened", "기간 단축 결정"],
        ["ended", "요양 종결"],
      ]),
      ...fromTo,
      text("diagnosis", "승인 상병"),
      text("hospital", "산재보험 의료기관"),
      date("appointmentAt", "진료 예약일"),
      bool("extensionConsidered", "의료기관과 연장 검토 중"),
      select("extensionStatus", "진료계획 진행", [
        ["none", "해당 없음"],
        ["consult", "주치의 상담"],
        ["preparing", "병원 작성 중"],
        ["submitted", "병원 제출"],
        ["received", "공단 수신"],
        ["review", "심사 중"],
        ["decided", "변경 결정 수신"],
      ]),
      date("requestedTo", "신청한 종료일"),
      date("submittedAt", "병원 제출일"),
      date("receivedAt", "공단 접수일"),
      date("medicalCureDate", "의학적 치유일"),
    ],
  },
  benefit_claim: {
    title: "급여 청구·수급자격",
    group: "payments",
    officialStates: ["qualified", "approved"],
    fields: [
      select("benefitType", "급여 종류", [
        ["workers_comp_leave", "산재 휴업급여"],
        ["unemployment", "구직급여"],
        ["medical_expense", "요양비"],
        ["disability", "장해급여"],
        ["severance", "퇴직금·정산"],
      ]),
      status([
        ["estimate", "예상"],
        ["filed", "청구"],
        ["qualified", "수급자격 인정"],
        ["approved", "지급결정"],
        ["ended", "종료"],
      ]),
      ...fromTo,
      text("claimNo", "청구·결정번호"),
      num("dailyRate", "1일액"),
      num("allocatedDays", "부여·선택 일수", 0, 1500),
      num("incapacityDays", "실제 취업불능 일수", 0, 1500),
      num("workedDays", "기간 중 근무일", 0, 1500),
      num("wagesReceived", "기간 중 임금 수령액"),
      ...money,
      date("expiresAt", "수급기간 만료일"),
      date("firstRecognitionAt", "최초 실업인정일"),
      num("officialRemainingDays", "기관 표시 잔여일", 0, 1500),
      text("policyId", "계산 정책 ID"),
    ],
  },
  unemployment_activity: {
    title: "실업인정·구직활동",
    group: "tasks",
    fields: [
      text("claimId", "급여 기록 ID", true),
      num("cycle", "인정 회차", 1, 100),
      ...fromTo,
      date("recognitionAt", "실업인정일"),
      num("requiredActivities", "센터 지정 활동 수", 0, 50),
      num("completedActivities", "실제 활동 수", 0, 50),
      num("recognizedDays", "기관 인정일수", 0, 180),
      status([
        ["planned", "예정"],
        ["performed", "실제 활동"],
        ["submitted", "제출"],
        ["recognized", "기관 인정"],
        ["returned", "보완"],
      ]),
      bool("incomeOccurred", "근로·소득 발생"),
      select("incomeReport", "소득 신고", [
        ["none", "해당 없음"],
        ["needed", "확인·신고 필요"],
        ["reported", "신고함"],
      ]),
    ],
    officialStates: ["recognized"],
  },
  expense: {
    title: "본인부담 치료비",
    group: "payments",
    fields: [
      date("serviceDate", "진료·약제일", true),
      text("hospital", "병원·약국"),
      num("totalAmount", "본인부담 총액"),
      num("noncoveredAmount", "비급여 금액"),
      num("privateInsurancePaid", "실손보험 기수령액"),
      num("healthInsurancePaid", "건강보험 기지급액"),
      ...money,
      status([
        ["review", "청구 가능 여부 확인"],
        ["filed", "청구"],
        ["partial", "일부 인정"],
        ["denied", "인정 안 됨"],
        ["approved", "인정"],
      ]),
      text("claimId", "급여 청구 ID"),
      { key: "reason", label: "인정·제외 사유", type: "long" },
    ],
    officialStates: ["partial", "denied", "approved"],
  },
  disability: {
    title: "치료종결·장해 검토",
    group: "claim",
    fields: [
      date("medicalCureDate", "의학적 치유·종결일"),
      select("residual", "잔존 장해 확인", [
        ["unknown", "의료진 확인 필요"],
        ["none", "잔존 장해 없음"],
        ["possible", "의료진 검토 필요 소견"],
      ]),
      text("closureHospital", "종결 당시 산재보험 의료기관"),
      text("certificateHospital", "장해진단 발급기관"),
      text("exceptionReason", "다른 기관 발급 사유"),
      bool("specialExamRequested", "공단 전문진단 요청"),
      date("filedAt", "청구일"),
      text("officialGrade", "공식 장해등급"),
      status([
        ["review", "검토"],
        ["filed", "청구"],
        ["approved", "결정"],
        ["not_needed", "검토 불필요"],
      ]),
    ],
    officialStates: ["approved"],
  },
  additional_claim: {
    title: "추가상병·재요양",
    group: "claim",
    fields: [
      select("requestType", "신청 구분", [
        ["additional_disease", "추가상병"],
        ["recurrence", "재요양"],
      ]),
      date("requestedAt", "신청일"),
      text("medicalReason", "의학적 사유"),
      status([
        ["review", "상담"],
        ["filed", "신청"],
        ["approved", "승인"],
        ["denied", "불승인"],
      ]),
    ],
    officialStates: ["approved", "denied"],
  },
  employment: {
    title: "직장 이력",
    group: "employment",
    fields: [
      text("employerName", "직장 이름", true),
      text("jobTitle", "업무"),
      select("employmentType", "고용 형태", [
        ["regular", "상용"],
        ["temporary", "기간제"],
        ["daily", "일용"],
        ["part_time", "단시간"],
        ["labor", "노무제공"],
      ]),
      select("actualOrSimulated", "기록 구분", [
        ["actual", "실제"],
        ["planned", "예정"],
      ]),
      date("contractAt", "계약일"),
      date("hireDate", "입사일", true),
      date("firstWorkDate", "첫 근무일"),
      date("lastWorkDate", "마지막 근무일"),
      date("insuredFrom", "보험 취득일"),
      date("insuredLost", "보험 상실일"),
      num("weeklyHours", "주 소정근로시간", 0, 168),
      num("wage", "임금"),
      select("wageType", "임금 형태", [
        ["monthly", "월급"],
        ["hourly", "시급"],
      ]),
      date("contractEnd", "계약 만료일"),
      bool("previousBenefitsUsed", "이 기간의 과거 구직급여 수급"),
      text("sourceDocument", "계약서 문서 ID"),
    ],
  },
  paid_day: {
    title: "고용보험 유급일 확인",
    group: "employment",
    fields: [
      employer,
      date("date", "해당 날짜", true),
      select("dayType", "일수 종류", [
        ["paid_work", "유급근로"],
        ["paid_holiday", "유급주휴"],
        ["paid_leave", "유급휴가"],
        ["paid_public_holiday", "유급공휴일"],
        ["unpaid", "무급"],
        ["unknown", "확인 필요"],
      ]),
      select("verification", "확인 수준", [
        ["estimated", "예상"],
        ["documented", "서류 확인"],
        ["agency", "고용센터 확인"],
      ]),
      text("sourceDocument", "이직확인서·명세서 ID"),
    ],
  },
  resignation: {
    title: "퇴사 준비",
    group: "tasks",
    fields: [
      employer,
      status([
        ["start", "준비"],
        ["medical", "의사 확인 필요"],
        ["employer_request", "회사 문의"],
        ["employer_reply", "회사 답변"],
        ["negotiation", "퇴사 협의"],
        ["left", "퇴직"],
        ["agency", "기관 심사"],
      ]),
      date("plannedLeave", "예상 마지막 근무일"),
      date("actualLeave", "실제 마지막 근무일"),
      text("reason", "실제 이직사유"),
      bool("medicalRestriction", "의학적 업무제한 확인"),
      select("leaveResponse", "회사 병가·휴직 답변", [
        ["unknown", "확인 전"],
        ["allowed", "가능"],
        ["refused", "불가"],
        ["no_response", "답변 없음"],
      ]),
      select("transferResponse", "업무전환 답변", [
        ["unknown", "확인 전"],
        ["allowed", "가능"],
        ["refused", "불가"],
        ["no_response", "답변 없음"],
      ]),
      bool("separationFormFiled", "이직확인서 제출 확인"),
    ],
  },
  payroll: {
    title: "임금·근로조건",
    group: "payments",
    fields: [
      employer,
      date("periodFrom", "급여기간 시작"),
      date("periodTo", "급여기간 종료"),
      num("hourlyRate", "통상 시급"),
      num("basePay", "기본급"),
      num("overtimeHours", "법정 연장 시간", 0, 744),
      num("nightHours", "야간 시간", 0, 744),
      num("paidOvertime", "이미 받은 연장수당"),
      num("paidNight", "이미 받은 야간수당"),
      num("employeeCount", "상시 근로자 수", 0, 100000),
      bool("statementVerified", "급여명세·포함 수당 확인"),
      text("policyId", "계산 정책 ID"),
    ],
  },
  exposure: {
    title: "건강·업무부담 기록",
    group: "documents",
    fields: [
      employer,
      date("date", "기록 대상일", true),
      text("activity", "작업"),
      num("weightKg", "무게 kg", 0, 1000),
      num("repetitions", "반복 횟수", 0, 100000),
      num("minutes", "작업 시간(분)", 0, 1440),
      text("posture", "작업 자세"),
      select("measurement", "측정 구분", [
        ["unknown", "미측정"],
        ["estimated", "기억·추정"],
        ["measured", "실측"],
      ]),
      text("painArea", "아픈 부위"),
      num("painMorning", "출근 전 통증", 0, 10),
      num("painPeak", "가장 심한 통증", 0, 10),
      num("painEvening", "퇴근 후 통증", 0, 10),
      text("medicalOpinion", "의료진 소견"),
      select("diagnosisStatus", "진단 상태", [
        ["unknown", "미확정"],
        ["suspected", "의심"],
        ["confirmed", "의료진 확인"],
      ]),
      date("onsetDate", "처음 발생·악화일"),
    ],
  },
  simulation: {
    title: "직장 전환 시뮬레이터",
    group: "employment",
    fields: [
      date("hireDate", "가상 입사일", true),
      date("leaveDate", "가상 이직일", true),
      text("paidWeekdays", "유급요일 (일=0, 월=1 … 토=6)", true),
      text("unpaidDates", "무급일 (날짜, 쉼표로 구분)"),
      text("paidDates", "추가 유급일 (날짜, 쉼표로 구분)"),
      bool("weeklyHolidayVerified", "유급주휴 요건 확인"),
      select("leaveReason", "가상 최종 이직사유", [
        ["unknown", "미확인"],
        ["voluntary", "단순 자진퇴사"],
        ["contract_end", "계약종료"],
        ["dismissal", "해고·권고"],
        ["illness", "질병 사유 상담 필요"],
      ]),
      text("policyId", "계산 정책 ID"),
    ],
  },
  severance_leave: {
    title: "퇴직금·연차",
    group: "payments",
    fields: [
      employer,
      date("hireDate", "동일 사업장 입사일", true),
      date("leaveDate", "마지막 근무일", true),
      num("weeklyHours", "4주 평균 주 소정시간", 0, 168),
      num("averageDailyWage", "평균임금 일액"),
      num("ordinaryDailyWage", "통상임금 일액"),
      num("employeeCount", "상시 근로자 수", 0, 100000),
      num("attendancePercent", "출근율 %", 0, 100),
      num("fullAttendanceMonths", "1년 미만 개근 월수", 0, 11),
      num("leaveGranted", "회사 확인 발생 연차", 0, 100),
      num("leaveUsed", "사용 연차", 0, 100),
      num("leavePaid", "이미 정산된 연차", 0, 100),
      num("paidSeverance", "받은 퇴직금"),
      text("policyId", "계산 정책 ID"),
    ],
  },
  incident: {
    title: "회사 대화·분쟁 기록",
    group: "documents",
    fields: [
      employer,
      date("date", "발생일", true),
      select("knowledge", "기록 근거", [
        ["observed", "직접 경험·목격"],
        ["heard", "전해 들음"],
        ["inferred", "추정"],
      ]),
      text("topic", "상황"),
      text("recipient", "문의·전달 대상"),
      status([
        ["draft", "기록 중"],
        ["documented", "증빙 확보"],
        ["requested", "서면 요청"],
        ["referred", "기관 상담"],
        ["closed", "마무리"],
      ]),
      text("relatedMessage", "전달문 기록 ID"),
    ],
  },
} satisfies Record<string, RecordSpec>;
export type RecordKind = keyof typeof RECORD_SPECS;
export interface CasePayload {
  title: string;
  body: string;
  certainty: "reported" | "estimated" | "documented" | "official";
  sourceIds: string[];
  data: Record<string, string | number | boolean>;
}
export interface CaseRecord {
  id: string;
  caseId: string;
  kind: RecordKind;
  payload: CasePayload;
  revision: number;
  updatedBy: string;
  updatedAt: string;
  archivedAt: string | null;
}
export function isRecordKind(value: unknown): value is RecordKind {
  return typeof value === "string" && Object.hasOwn(RECORD_SPECS, value);
}
export function validatePayload(kind: RecordKind, value: unknown): CasePayload {
  if (!value || typeof value !== "object") throw new Error("INVALID_RECORD");
  const p = value as CasePayload;
  if (
    typeof p.title !== "string" ||
    !p.title.trim() ||
    p.title.length > 160 ||
    typeof p.body !== "string" ||
    p.body.length > 60000
  )
    throw new Error("INVALID_TEXT");
  if (
    !["reported", "estimated", "documented", "official"].includes(
      p.certainty,
    ) ||
    !Array.isArray(p.sourceIds) ||
    p.sourceIds.length > 30 ||
    p.sourceIds.some((id) => typeof id !== "string" || id.length > 80)
  )
    throw new Error("INVALID_SOURCE");
  if (!p.data || typeof p.data !== "object" || Array.isArray(p.data))
    throw new Error("INVALID_FIELDS");
  const spec: RecordSpec = RECORD_SPECS[kind];
  for (const key of Object.keys(p.data))
    if (!spec.fields.some((f) => f.key === key))
      throw new Error("UNKNOWN_FIELD");
  for (const f of spec.fields) {
    const v = p.data[f.key];
    if (v === undefined || v === "") {
      if (f.required) throw new Error("REQUIRED_FIELD:" + f.key);
      continue;
    }
    if (f.type === "number") {
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        (![
          "weeklyHours",
          "overtimeHours",
          "nightHours",
          "weightKg",
          "leaveGranted",
          "leaveUsed",
          "leavePaid",
          "attendancePercent",
        ].includes(f.key) &&
          !Number.isInteger(v)) ||
        v < (f.min ?? 0) ||
        v > (f.max ?? 100000000000)
      )
        throw new Error("INVALID_NUMBER:" + f.key);
    } else if (f.type === "boolean") {
      if (typeof v !== "boolean") throw new Error("INVALID_BOOLEAN");
    } else {
      if (
        typeof v !== "string" ||
        v.length > (f.type === "long" ? 20000 : 2000)
      )
        throw new Error("INVALID_FIELD:" + f.key);
      if (f.type === "date" && !validDate(v))
        throw new Error("INVALID_DATE:" + f.key);
      if (f.type === "select" && !f.options?.some((o) => o[0] === v))
        throw new Error("INVALID_OPTION:" + f.key);
      if (f.key === "url" && v && !/^https:\/\//.test(v))
        throw new Error("INVALID_URL");
    }
  }
  const d = p.data;
  for (const [from, to] of [
    ["from", "to"],
    ["hireDate", "lastWorkDate"],
    ["hireDate", "leaveDate"],
    ["periodFrom", "periodTo"],
  ])
    if (d[from] && d[to]) inclusiveDays(String(d[from]), String(d[to]));
  if (
    spec.officialStates?.includes(String(d.status)) &&
    (p.certainty !== "official" || !p.sourceIds.length)
  )
    throw new Error("OFFICIAL_SOURCE_REQUIRED");
  if (p.certainty === "official" && !p.sourceIds.length)
    throw new Error("OFFICIAL_SOURCE_REQUIRED");
  if (
    kind === "treatment" &&
    spec.officialStates?.includes(String(d.status)) &&
    (!d.from || !d.to)
  )
    throw new Error("TREATMENT_PERIOD_REQUIRED");
  if (kind === "intake" && d.status === "filed" && (!d.receiptNo || !d.filedAt))
    throw new Error("RECEIPT_REQUIRED");
  if (
    kind === "disability" &&
    d.status === "approved" &&
    (!d.officialGrade || !d.medicalCureDate || d.residual !== "possible")
  )
    throw new Error("DISABILITY_EVIDENCE_REQUIRED");
  if (
    kind === "disability" &&
    d.certificateHospital &&
    d.closureHospital &&
    d.certificateHospital !== d.closureHospital &&
    !d.exceptionReason
  )
    throw new Error("HOSPITAL_EXCEPTION_REQUIRED");
  if (kind === "simulation") {
    const weekdays = String(d.paidWeekdays)
      .split(",")
      .map((v) => v.trim());
    if (weekdays.some((v) => !/^[0-6]$/.test(v)))
      throw new Error("INVALID_WEEKDAYS");
    for (const key of ["unpaidDates", "paidDates"])
      if (
        d[key] &&
        String(d[key])
          .split(",")
          .some((v) => !validDate(v.trim()))
      )
        throw new Error("INVALID_EXCEPTION_DATE");
  }
  return {
    title: p.title.trim(),
    body: p.body,
    certainty: p.certainty,
    sourceIds: [...new Set(p.sourceIds)],
    data: { ...p.data },
  };
}
