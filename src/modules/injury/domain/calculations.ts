import { addDays, addMonths, dates, day, inclusiveDays } from "./dates";
export interface LegalPolicy {
  id: string;
  key: string;
  version: string;
  effectiveFrom: string;
  effectiveTo: string;
  status: "proposed" | "enacted" | "effective";
  sourceUrl: string;
  checkedAt: string;
  values: Record<string, number>;
}
export function requirePolicy(
  policy: LegalPolicy | undefined,
  key: string,
  date: string,
  keys: string[],
): LegalPolicy {
  if (
    !policy ||
    policy.key !== key ||
    policy.status !== "effective" ||
    date < policy.effectiveFrom ||
    date > policy.effectiveTo ||
    !/^https:\/\//.test(policy.sourceUrl) ||
    keys.some((k) => !Number.isFinite(policy.values[k]))
  )
    throw new Error("VERIFIED_POLICY_REQUIRED");
  return policy;
}
export function estimateWorkInjury(
  input: {
    date: string;
    averageDailyWage: number;
    incapacityDays: number;
    partialWork: boolean;
    specialCase: boolean;
  },
  policy: LegalPolicy,
) {
  requirePolicy(policy, "work_injury", input.date, [
    "baseRate",
    "lowRate",
    "minimumCompensationDaily",
    "lowThresholdRate",
    "minimumWageDaily",
    "excludedShortDays",
    "maximumCompensationDaily",
  ]);
  if (input.partialWork || input.specialCase)
    return {
      amount: null,
      dailyRate: null,
      status: "agency_review" as const,
      policyId: policy.id,
    };
  if (
    input.averageDailyWage < 0 ||
    !Number.isFinite(input.averageDailyWage) ||
    !Number.isInteger(input.incapacityDays) ||
    input.incapacityDays < 0 ||
    input.incapacityDays > 1500
  )
    throw new Error("INVALID_INPUT");
  const p = policy.values,
    base =
      Math.min(input.averageDailyWage, p.maximumCompensationDaily) * p.baseRate,
    threshold = p.minimumCompensationDaily * p.lowThresholdRate;
  let daily = base;
  if (base <= threshold) {
    const low = input.averageDailyWage * p.lowRate;
    daily = low < threshold ? low : threshold;
    if (daily < p.minimumWageDaily) daily = p.minimumWageDaily;
  }
  const amount =
    input.incapacityDays <= p.excludedShortDays
      ? 0
      : Math.floor(daily * input.incapacityDays);
  return {
    amount,
    dailyRate: daily,
    status: "estimate" as const,
    policyId: policy.id,
  };
}
export function estimateUnemployment(
  input: {
    date: string;
    averageDailyWage: number;
    ordinaryDailyWage: number;
    dailyWorker: boolean;
    specialBasis: boolean;
    scheduledDailyHours: number;
    allocatedDays: number;
  },
  policy: LegalPolicy,
) {
  requirePolicy(policy, "unemployment", input.date, [
    "baseRate",
    "minimumWageHourly",
    "minimumRate",
    "maximumDaily",
    "maximumHours",
  ]);
  const p = policy.values;
  if (
    !Number.isFinite(input.averageDailyWage) ||
    !Number.isFinite(input.ordinaryDailyWage) ||
    input.ordinaryDailyWage < 0 ||
    !Number.isFinite(input.scheduledDailyHours) ||
    input.averageDailyWage < 0 ||
    input.scheduledDailyHours <= 0 ||
    input.scheduledDailyHours > p.maximumHours ||
    !Number.isInteger(input.allocatedDays) ||
    input.allocatedDays < 0 ||
    input.allocatedDays > 500
  )
    throw new Error("INVALID_INPUT");
  if (input.specialBasis)
    return { amount: null, dailyRate: null, status: "agency_review" as const };
  // Short-time rules need a separately verified hour bracket; do not extrapolate an 8h rule.
  if (input.scheduledDailyHours !== p.maximumHours)
    return { amount: null, dailyRate: null, status: "hours_review" as const };
  const minimum =
    p.minimumWageHourly * input.scheduledDailyHours * p.minimumRate;
  const daily = Math.min(
    p.maximumDaily,
    Math.max(
      minimum,
      (input.dailyWorker
        ? input.averageDailyWage
        : Math.max(input.averageDailyWage, input.ordinaryDailyWage)) *
        p.baseRate,
    ),
  );
  return {
    amount: Math.floor(daily * input.allocatedDays),
    dailyRate: daily,
    status: "estimate" as const,
    policyId: policy.id,
  };
}
export interface PaidDay {
  date: string;
  employmentId: string;
  type: string;
  verification: "estimated" | "documented" | "agency";
  sourceId?: string;
}
export interface InsuranceWindow {
  months: number;
  requiredDays: number;
  extensionDays?: number;
  exceptionEvidence?: string;
  exceptionKind?: "illness_unpaid" | "short_hours";
  maxMonths?: number;
  priorBenefitLostDate?: string;
}
export function insuredDays(
  records: PaidDay[],
  leaveDate: string,
  policy: InsuranceWindow,
) {
  if (
    !Number.isInteger(policy.months) ||
    policy.months < 1 ||
    policy.months > 36 ||
    policy.requiredDays <= 0
  )
    throw new Error("INVALID_WINDOW");
  if (
    (policy.extensionDays || policy.months !== 18) &&
    (!policy.exceptionEvidence || !policy.exceptionKind)
  )
    throw new Error("EXCEPTION_EVIDENCE_REQUIRED");
  if (
    policy.extensionDays &&
    (policy.exceptionKind !== "illness_unpaid" ||
      policy.extensionDays < 30 ||
      !Number.isInteger(policy.extensionDays))
  )
    throw new Error("INVALID_EXTENSION");
  const lower = addDays(addMonths(leaveDate, -policy.months), 1);
  const earliest = addDays(addMonths(leaveDate, -(policy.maxMonths ?? 36)), 1);
  const start = policy.extensionDays
    ? [addDays(lower, -policy.extensionDays), earliest].sort().at(-1)!
    : lower;
  const groups = new Map<string, PaidDay[]>();
  let outside = 0;
  for (const item of records) {
    day(item.date);
    if (
      item.date < start ||
      item.date > leaveDate ||
      (policy.priorBenefitLostDate && item.date < policy.priorBenefitLostDate)
    ) {
      outside++;
      continue;
    }
    const g = groups.get(item.date) ?? [];
    g.push(item);
    groups.set(item.date, g);
  }
  let documented = 0,
    estimated = 0;
  const ambiguous: string[] = [];
  for (const [date, group] of groups) {
    const paid = group.filter((r) => /^paid_/.test(r.type));
    if (!paid.length) continue;
    if (
      new Set(group.map((r) => r.employmentId)).size > 1 ||
      group.some((r) => r.type === "unpaid" || r.type === "unknown")
    ) {
      ambiguous.push(date);
      continue;
    }
    if (paid.some((r) => r.verification !== "estimated" && r.sourceId))
      documented++;
    else estimated++;
  }
  return {
    start,
    end: leaveDate,
    documentedDays: documented,
    estimatedDays: estimated,
    ambiguousDates: ambiguous,
    outsideRecords: outside,
    missingDocumentedDays: Math.max(0, policy.requiredDays - documented),
    calculatedThresholdMet: documented >= policy.requiredDays,
    eligibilityConfirmed: false as const,
  };
}
export function simulateEmployment(
  input: {
    previous: PaidDay[];
    hireDate: string;
    leaveDate: string;
    paidWeekdays: number[];
    unpaidDates: string[];
    extraPaidDates: string[];
    weeklyHolidayVerified: boolean;
  },
  policy: InsuranceWindow,
) {
  const range = dates(input.hireDate, input.leaveDate);
  if (range.length > 1500) throw new Error("SIMULATION_RANGE_TOO_LONG");
  const future: PaidDay[] = [];
  let firstExpected: string | null = null;
  const initial = insuredDays(input.previous, input.hireDate, policy);
  for (const date of range) {
    if (
      !input.unpaidDates.includes(date) &&
      (input.paidWeekdays.includes(new Date(day(date)).getUTCDay()) ||
        input.extraPaidDates.includes(date))
    ) {
      future.push({
        date,
        employmentId: "simulation",
        type: "paid_work",
        verification: "estimated",
      });
    }
    const result = insuredDays([...input.previous, ...future], date, policy);
    if (
      !firstExpected &&
      result.documentedDays + result.estimatedDays >= policy.requiredDays &&
      input.weeklyHolidayVerified
    )
      firstExpected = date;
  }
  const final = insuredDays(
    [...input.previous, ...future],
    input.leaveDate,
    policy,
  );
  return {
    ...final,
    firstExpectedDate: firstExpected,
    simulatedPaidDays: future.length,
    previousDaysExpired: Math.max(
      0,
      initial.documentedDays -
        insuredDays(input.previous, input.leaveDate, policy).documentedDays,
    ),
    weeklyHolidayNeedsReview: !input.weeklyHolidayVerified,
  };
}
export interface InsuredPeriod {
  from: string;
  lost: string;
  previousBenefitsUsed: boolean;
}
export function aggregateInsuredPeriods(
  periods: InsuredPeriod[],
  asOf: string,
) {
  day(asOf);
  for (const p of periods) {
    day(p.from);
    day(p.lost);
    if (p.lost <= p.from) throw Error("INVALID_INPUT");
  }
  const sorted = periods
    .filter((p) => p.from <= asOf)
    .sort((a, b) => b.from.localeCompare(a.from));
  const included = new Set<string>();
  let nextFrom = asOf;
  for (const p of sorted) {
    if (p.previousBenefitsUsed || p.lost < addMonths(nextFrom, -36)) break;
    const end = [addDays(p.lost, -1), asOf].sort()[0];
    if (end >= p.from) for (const d of dates(p.from, end)) included.add(d);
    nextFrom = p.from;
  }
  return {
    insuredCalendarDays: included.size,
    milestones: [1, 3, 5].map((years) => ({
      years,
      remainingCalendarDays: Math.max(0, years * 365 - included.size),
    })),
    agencyConfirmationRequired: true as const,
  };
}
export interface PaymentEvent {
  id: string;
  eventType: "decision" | "deposit" | "decision_adjustment" | "refund";
  amount: number;
  recognizedDays: number;
}
export function summarizeLedger(
  input: {
    benefitType: string;
    dailyRate: number | null;
    allocatedDays: number | null;
    expectedAmount: number | null;
    officialRemainingDays?: number | null;
  },
  events: PaymentEvent[],
) {
  const unique = new Map(events.map((e) => [e.id, e]));
  if (unique.size !== events.length) throw new Error("DUPLICATE_PAYMENT_EVENT");
  let approved = 0,
    paid = 0,
    recognized = 0;
  for (const e of events) {
    if (!Number.isSafeInteger(e.amount) || !Number.isInteger(e.recognizedDays))
      throw new Error("INVALID_PAYMENT");
    if (e.eventType === "decision" || e.eventType === "decision_adjustment") {
      approved += e.amount;
      recognized += e.recognizedDays;
    } else paid += e.eventType === "refund" ? -e.amount : e.amount;
  }
  const expected =
    input.expectedAmount ??
    (input.dailyRate !== null && input.allocatedDays !== null
      ? input.dailyRate * input.allocatedDays
      : null);
  const remaining =
    input.benefitType === "unemployment" && input.allocatedDays !== null
      ? (input.officialRemainingDays ??
        Math.max(0, input.allocatedDays - recognized))
      : null;
  return {
    expectedTotal: expected,
    approvedTotal: approved,
    actualPaid: paid,
    approvedOutstanding: Math.max(0, approved - paid),
    conditionalRemaining:
      expected === null ? null : Math.max(0, expected - approved),
    recognizedDays: recognized,
    remainingDays: remaining,
    overpayment: Math.max(0, paid - approved),
    needsReconciliation:
      recognized < 0 ||
      approved < 0 ||
      paid < 0 ||
      (input.allocatedDays !== null && recognized > input.allocatedDays),
  };
}
export function payrollEstimate(
  input: {
    date: string;
    hourlyRate: number;
    overtimeHours: number;
    nightHours: number;
    paidOvertime: number;
    paidNight: number;
    employeeCount: number;
    statementVerified: boolean;
  },
  policy: LegalPolicy,
) {
  requirePolicy(policy, "employment_pay", input.date, [
    "minimumEmployees",
    "overtimeMultiplier",
    "nightPremium",
  ]);
  if (
    input.employeeCount < policy.values.minimumEmployees ||
    !input.statementVerified
  )
    return { unpaidEstimate: null, status: "review_required" as const };
  if (
    Object.values(input).some(
      (v) => typeof v === "number" && (!Number.isFinite(v) || v < 0),
    )
  )
    throw new Error("INVALID_INPUT");
  const overtime =
    input.hourlyRate * input.overtimeHours * policy.values.overtimeMultiplier;
  const night =
    input.hourlyRate * input.nightHours * policy.values.nightPremium;
  return {
    unpaidEstimate: Math.floor(
      Math.max(0, overtime - input.paidOvertime) +
        Math.max(0, night - input.paidNight),
    ),
    status: "estimate" as const,
  };
}
export function severanceEstimate(
  input: {
    hireDate: string;
    leaveDate: string;
    weeklyHours: number;
    averageDailyWage: number;
    ordinaryDailyWage: number;
    paid: number;
  },
  policy: LegalPolicy,
) {
  requirePolicy(policy, "employment_pay", input.leaveDate, [
    "minimumWeeklyHours",
    "severanceDailyFactor",
    "yearDays",
  ]);
  if (
    Object.values(input).some(
      (v) => typeof v === "number" && (!Number.isFinite(v) || v < 0),
    )
  )
    throw new Error("INVALID_INPUT");
  const tenure = inclusiveDays(input.hireDate, input.leaveDate);
  const qualifies =
    addDays(addMonths(input.hireDate, 12), -1) <= input.leaveDate &&
    input.weeklyHours >= policy.values.minimumWeeklyHours;
  const estimated = qualifies
    ? Math.floor(
        (Math.max(input.averageDailyWage, input.ordinaryDailyWage) *
          policy.values.severanceDailyFactor *
          tenure) /
          policy.values.yearDays,
      )
    : 0;
  return {
    tenureCalendarDays: tenure,
    qualifiesByEnteredFacts: qualifies,
    estimatedAmount: estimated,
    outstandingEstimate: Math.max(0, estimated - input.paid),
    official: false as const,
  };
}
export function annualLeaveEstimate(
  input: {
    hireDate: string;
    leaveDate: string;
    weeklyHours: number;
    employeeCount: number;
    attendancePercent: number;
    fullAttendanceMonths: number;
    granted: number | null;
    used: number;
    paid: number;
  },
  policy: LegalPolicy,
) {
  requirePolicy(policy, "employment_pay", input.leaveDate, [
    "minimumWeeklyHours",
    "minimumEmployees",
    "annualLeaveBase",
    "annualLeaveCap",
    "attendanceThreshold",
  ]);
  if (
    input.weeklyHours < policy.values.minimumWeeklyHours ||
    input.employeeCount < policy.values.minimumEmployees
  )
    return { available: null, status: "review_required" as const };
  if (
    Object.values(input).some(
      (v) => typeof v === "number" && (!Number.isFinite(v) || v < 0),
    )
  )
    throw new Error("INVALID_INPUT");
  inclusiveDays(input.hireDate, input.leaveDate);
  let years = 0;
  while (addMonths(input.hireDate, (years + 1) * 12) <= input.leaveDate)
    years++;
  // Year-one expiry/continuous employment at accrual needs actual employer confirmation.
  const forecast =
    years < 1
      ? input.fullAttendanceMonths
      : input.attendancePercent >= policy.values.attendanceThreshold
        ? Math.min(
            policy.values.annualLeaveCap,
            policy.values.annualLeaveBase + Math.floor((years - 1) / 2),
          )
        : null;
  const granted = input.granted ?? forecast;
  return {
    available:
      granted === null ? null : Math.max(0, granted - input.used - input.paid),
    accrualEstimate: forecast,
    status: "estimate" as const,
    expiryNeedsReview: true,
  };
}
