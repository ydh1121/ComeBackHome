import type { CasePayload, CaseRecord } from "../domain/records";
export const QUESTIONS = [
    { title: "산재 신청은 어디까지 했나요?", options: [["before", "아직 신청 전이에요"], ["hospital", "병원에 문의했어요"], ["filed", "공단에 접수했어요"], ["investigating", "공단에서 조사 중이에요"], ["decision", "결과를 받았어요"]] },
    { title: "지금 회사에 다니고 있나요?", options: [["working", "재직 중이에요"], ["left", "퇴사했어요"], ["leave", "휴직·병가 중이에요"]] },
    { title: "병원에서 어떤 이야기를 들었나요?", options: [["checking", "진료 중이고 아직 잘 몰라요"], ["restriction", "쉬거나 일을 줄이라는 말을 들었어요"], ["document", "진단서나 결정문을 받았어요"]] },
] as const;
export interface AdvisorProfile {
    version: 1;
    answers: (string | null)[];
    cursor: number;
    confirmed: boolean;
    deferred: boolean;
}
export const emptyProfile = (): AdvisorProfile => ({ version: 1, answers: [null, null, null], cursor: 0, confirmed: false, deferred: false });
export const profileId = (caseId: string) => "advisor-profile-v1-" + caseId;
export const scriptId = (caseId: string) => "advisor-hospital-v1-" + caseId;
export function isProfile(record: CaseRecord): boolean { return record.kind === "content" && record.payload.data.recipient === "advisor-profile/v1"; }
export function readProfile(record?: CaseRecord): AdvisorProfile | null {
    if (!record || record.archivedAt || !isProfile(record))
        return null;
    try {
        const p = JSON.parse(record.payload.body);
        if (p.version !== 1 || !Array.isArray(p.answers) || p.answers.length !== 3 || !Number.isInteger(p.cursor) || p.cursor < 0 || p.cursor > 3 || typeof p.confirmed !== "boolean" || typeof p.deferred !== "boolean")
            return null;
        if (!p.answers.every((v: unknown, i: number) => v === null || QUESTIONS[i].options.some(([key]) => key === v)))
            return null;
        return { version: 1, answers: [...p.answers], cursor: p.cursor, confirmed: p.confirmed, deferred: p.deferred };
    }
    catch {
        return null;
    }
}
export function answerText(index: number, value: string | null): string {
    return QUESTIONS[index].options.find(([key]) => key === value)?.[1] ?? "아직 잘 모르겠어요";
}
export function profilePayload(profile: AdvisorProfile): CasePayload {
    return { title: "도우미에서 확인한 내 상황", body: JSON.stringify(profile), certainty: "reported", sourceIds: [], data: { category: "reference", medium: "none", recipient: "advisor-profile/v1" } };
}
export const HOSPITAL_SCRIPT = "지금 하는 일이 몸에 무리가 되는지 상담하고 싶습니다. 제가 하는 작업과 불편한 증상을 말씀드릴게요. 원인을 확인하려면 어떤 검사가 필요한가요? 일을 계속해도 괜찮은지, 줄이거나 피해야 할 작업이 있는지도 알려주세요.";
export function scriptPayload(body: string): CasePayload {
    return { title: "병원에 물어볼 말", body, certainty: "reported", sourceIds: [], data: { category: "message", medium: "spoken", recipient: "의사" } };
}
export function advisorSummary(records: CaseRecord[], profile: AdvisorProfile | null): {
    label: string;
    review: boolean;
    source: string;
} {
    const intake = records.find(r => r.kind === "intake" && !r.archivedAt);
    if (intake) {
        const names: Record<string, string> = { preparing: "산재 신청을 준비하는 단계", filed: "공단 접수를 확인하는 단계", investigating: "공단에서 조사하는 단계", employer: "회사 의견을 확인하는 단계", committee: "공단의 심사·보완을 확인하는 단계", approved: "승인 결과를 확인하는 단계", partial: "일부 승인 결과를 확인하는 단계", denied: "받은 결정문을 확인하는 단계" };
        return { label: names[String(intake.payload.data.status)] ?? "저장한 진행 상황을 확인해 주세요", review: true, source: intake.payload.certainty === "official" ? "기관 자료를 연결한 기존 기록" : "기존에 적어 둔 내용 · 현재 상황 확인 필요" };
    }
    if (profile?.confirmed)
        return { label: answerText(0, profile.answers[0]), review: ["filed", "investigating", "decision"].includes(profile.answers[0] ?? ""), source: "직접 알려주신 내용 · 기관 확인과는 달라요" };
    return { label: "현재 단계 확인이 필요해요", review: false, source: "입력하지 않아도 안내를 볼 수 있어요" };
}
