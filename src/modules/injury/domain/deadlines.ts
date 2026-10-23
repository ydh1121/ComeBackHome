import { requirePolicy, type LegalPolicy } from "./calculations";
import { addDays, todaySeoul } from "./dates";
import type { CaseRecord } from "./records";
export interface CaseDeadline {
  id: string;
  recordId: string;
  date: string;
  kind: "recommended" | "legal_check" | "official";
  action:
    | "treatment_consult"
    | "plan_prepare"
    | "plan_receipt"
    | "employer_reply"
    | "appeal"
    | "expiry"
    | "appointment"
    | "task";
  responsible: "hospital" | "employer" | "owner" | "agency";
  overdue: boolean;
}
export function caseDeadlines(
  records: CaseRecord[],
  today = todaySeoul(),
  policies: LegalPolicy[] = [],
): CaseDeadline[] {
  const result: CaseDeadline[] = [];
  const add = (
    r: CaseRecord,
    date: string,
    action: CaseDeadline["action"],
    kind: CaseDeadline["kind"],
    responsible: CaseDeadline["responsible"],
  ) => {
    result.push({
      id: `${r.id}:${r.revision}:${action}:${date}`,
      recordId: r.id,
      date,
      kind,
      action,
      responsible,
      overdue: date < today,
    });
  };
  for (const r of records.filter((r) => !r.archivedAt)) {
    const d = r.payload.data;
    const at = String(d.knownAt || d.notifiedAt || d.to || today);
    const policy = policies.find(
      (p) =>
        p.key === "deadlines" &&
        p.status === "effective" &&
        p.effectiveFrom <= at &&
        p.effectiveTo >= at,
    );
    let limits: Record<string, number> | null = null;
    try {
      limits = requirePolicy(policy, "deadlines", at, [
        "consultLead",
        "prepareLead",
        "planLead",
        "appealDays",
        "employerDays",
        "employerExtensionDays",
      ]).values;
    } catch {
      /* No unverified legal dates. */
    }
    if (r.kind === "treatment") {
      if (d.appointmentAt)
        add(r, String(d.appointmentAt), "appointment", "official", "owner");
      if (
        limits &&
        r.payload.certainty === "official" &&
        d.to &&
        d.status !== "ended" &&
        d.extensionConsidered === true
      ) {
        add(
          r,
          addDays(String(d.to), -limits.consultLead),
          "treatment_consult",
          "recommended",
          "owner",
        );
        add(
          r,
          addDays(String(d.to), -limits.prepareLead),
          "plan_prepare",
          "recommended",
          "hospital",
        );
        if (!d.receivedAt)
          add(
            r,
            addDays(String(d.to), -limits.planLead),
            "plan_receipt",
            "legal_check",
            "hospital",
          );
      }
    }
    if (
      limits &&
      r.kind === "intake" &&
      ["denied", "partial"].includes(String(d.status)) &&
      r.payload.certainty === "official" &&
      d.knownAt
    )
      add(
        r,
        addDays(String(d.knownAt), limits.appealDays),
        "appeal",
        "legal_check",
        "owner",
      );
    if (
      limits &&
      r.kind === "employer_opinion" &&
      d.notifiedAt &&
      !d.replyAt &&
      !["omitted", "closed"].includes(String(d.status))
    )
      add(
        r,
        addDays(
          String(d.notifiedAt),
          limits.employerDays +
            (d.extensionConfirmed === true ? limits.employerExtensionDays : 0),
        ),
        "employer_reply",
        "legal_check",
        "employer",
      );
    if (r.kind === "benefit_claim" && d.expiresAt)
      add(
        r,
        String(d.expiresAt),
        "expiry",
        r.payload.certainty === "official" ? "official" : "legal_check",
        "owner",
      );
    if (
      ["task", "agency_request"].includes(r.kind) &&
      d.dueDate &&
      !["done", "cancelled"].includes(String(d.status))
    )
      add(
        r,
        String(d.dueDate),
        "task",
        d.deadlineKind === "recommended"
          ? "recommended"
          : d.deadlineKind === "legal"
            ? "legal_check"
            : "official",
        "owner",
      );
    if (
      r.kind === "unemployment_activity" &&
      d.recognitionAt &&
      d.status !== "recognized"
    )
      add(r, String(d.recognitionAt), "appointment", "official", "owner");
  }
  return result.sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
}
export function benefitOverlapWarnings(
  records: CaseRecord[],
): Array<{ left: string; right: string }> {
  const claims = records.filter(
      (r) =>
        r.kind === "benefit_claim" &&
        !r.archivedAt &&
        r.payload.data.from &&
        r.payload.data.to,
    ),
    result = [];
  for (let i = 0; i < claims.length; i++)
    for (let j = i + 1; j < claims.length; j++) {
      const a = claims[i].payload.data,
        b = claims[j].payload.data;
      if (
        new Set([a.benefitType, b.benefitType]).size === 2 &&
        [a.benefitType, b.benefitType].every((v) =>
          ["workers_comp_leave", "unemployment"].includes(String(v)),
        ) &&
        String(a.from) <= String(b.to) &&
        String(b.from) <= String(a.to)
      )
        result.push({ left: claims[i].id, right: claims[j].id });
    }
  return result;
}
