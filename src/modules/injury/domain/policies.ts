import type { LegalPolicy } from "./calculations";
import { validDate, todaySeoul } from "./dates";
// Schema constraints, not legal values. Values are versioned, editable D1 data.
export const POLICY_FIELDS: Record<string, string[]> = {
  work_injury: [
    "baseRate",
    "lowRate",
    "minimumCompensationDaily",
    "lowThresholdRate",
    "minimumWageDaily",
    "excludedShortDays",
    "maximumCompensationDaily",
  ],
  unemployment: [
    "baseRate",
    "minimumWageHourly",
    "minimumRate",
    "maximumDaily",
    "maximumHours",
  ],
  insurance_window: ["months", "requiredDays", "maxMonths"],
  employment_pay: [
    "minimumEmployees",
    "overtimeMultiplier",
    "nightPremium",
    "minimumWeeklyHours",
    "severanceDailyFactor",
    "yearDays",
    "annualLeaveBase",
    "annualLeaveCap",
    "attendanceThreshold",
  ],
  deadlines: [
    "inquiryDays",
    "consultLead",
    "prepareLead",
    "planLead",
    "appealDays",
    "employerDays",
    "employerExtensionDays",
  ],
};
export function validPolicy(p: LegalPolicy): boolean {
  if (
    !p ||
    !Object.hasOwn(POLICY_FIELDS, p.key) ||
    !validDate(p.effectiveFrom) ||
    !validDate(p.effectiveTo) ||
    p.effectiveFrom > p.effectiveTo ||
    !validDate(p.checkedAt) ||
    p.checkedAt > todaySeoul() ||
    (p.status === "effective" && p.effectiveFrom > p.checkedAt) ||
    !["proposed", "enacted", "effective"].includes(p.status) ||
    typeof p.version !== "string" ||
    !p.version.trim() ||
    p.version.length > 80 ||
    typeof p.sourceUrl !== "string" ||
    !officialSource(p.sourceUrl)
  )
    return false;
  if (
    !p.values ||
    typeof p.values !== "object" ||
    Array.isArray(p.values) ||
    Object.keys(p.values).length > 40 ||
    POLICY_FIELDS[p.key].some((k) => p.values[k] === undefined) ||
    Object.values(p.values).some(
      (v) =>
        typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1000000000,
    )
  )
    return false;
  for (const [key, value] of Object.entries(p.values)) {
    if (/Rate$|Premium$/.test(key) && value > 1) return false;
    if (
      /Days$|Lead$|Employees$|^months$|^maxMonths$|annualLeave/.test(key) &&
      !Number.isInteger(value)
    )
      return false;
  }
  const v = p.values;
  if (
    p.key === "work_injury" &&
    (v.baseRate === 0 ||
      v.lowRate === 0 ||
      v.maximumCompensationDaily < v.minimumCompensationDaily ||
      v.excludedShortDays > 30)
  )
    return false;
  if (
    p.key === "unemployment" &&
    (v.maximumHours <= 0 ||
      v.maximumHours > 24 ||
      v.maximumDaily < v.minimumWageHourly * v.minimumRate * v.maximumHours)
  )
    return false;
  if (
    p.key === "insurance_window" &&
    (v.months < 1 ||
      v.months > v.maxMonths ||
      v.maxMonths > 36 ||
      v.requiredDays < 1 ||
      v.requiredDays > 366)
  )
    return false;
  if (
    p.key === "employment_pay" &&
    (v.yearDays < 365 ||
      v.yearDays > 366 ||
      v.annualLeaveBase > v.annualLeaveCap ||
      v.attendanceThreshold > 100 ||
      v.overtimeMultiplier < 1)
  )
    return false;
  return true;
}
function officialSource(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      [
        "law.go.kr",
        "moel.go.kr",
        "work24.go.kr",
        "comwel.or.kr",
        "easylaw.go.kr",
      ].some(
        (domain) =>
          url.hostname === domain || url.hostname.endsWith("." + domain),
      )
    );
  } catch {
    return false;
  }
}
