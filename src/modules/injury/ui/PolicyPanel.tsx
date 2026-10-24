import { useState } from "react";
import { privateRequest } from "../../auth/client";
import { POLICY_FIELDS, validPolicy } from "../domain/policies";
import type { LegalPolicy } from "../domain/calculations";
import { todaySeoul } from "../domain/dates";
import type { CaseData } from "./types";

export const policyNames: Record<string, string> = {
  work_injury: "휴업급여",
  unemployment: "구직급여",
  insurance_window: "고용보험 산정 기간",
  employment_pay: "임금·퇴직금·연차",
  deadlines: "기한 알림",
};
const fieldNames: Record<string, string> = {
  inquiryDays: "접수 후 진행 문의 권장일수 (자동 결정일 아님)",
  baseRate: "기본 지급 비율 (0~1)",
  lowRate: "저소득 보정 비율 (0~1)",
  minimumCompensationDaily: "최저 보상기준 1일액",
  lowThresholdRate: "저소득 판단 비율 (0~1)",
  minimumWageDaily: "최저임금 1일액",
  excludedShortDays: "지급 제외되는 단기 일수",
  maximumCompensationDaily: "최고 보상기준 1일액",
  minimumWageHourly: "최저임금 시급",
  minimumRate: "하한 비율 (0~1)",
  maximumDaily: "1일 지급 상한액",
  maximumHours: "일반 산식의 1일 소정시간",
  months: "일반 기준기간 (개월)",
  requiredDays: "필요 피보험단위일수",
  maxMonths: "연장 시 최대 기준기간 (개월)",
  minimumEmployees: "법정 가산·연차 적용 상시근로자 수",
  overtimeMultiplier: "연장근로 총 지급 배수",
  nightPremium: "야간근로 추가 가산 비율",
  minimumWeeklyHours: "최소 주 소정근로시간",
  severanceDailyFactor: "1년당 퇴직금 평균임금 일수",
  yearDays: "퇴직금 비례산정 1년 일수",
  annualLeaveBase: "일반 연차 기본 일수",
  annualLeaveCap: "연차 최대 일수",
  attendanceThreshold: "연차 출근율 기준 (%)",
  consultLead: "요양 종료 전 상담 안내 (일)",
  prepareLead: "요양 종료 전 작성 준비 안내 (일)",
  planLead: "진료계획 제출 확인 선행일",
  appealDays: "결정을 안 날부터 심사청구 확인일수",
  employerDays: "사업주 의견 기본 제출일수",
  employerExtensionDays: "확인된 연장일수",
};
const statuses: Record<string, string> = {
  proposed: "검토 중",
  enacted: "공포·시행 전",
  effective: "시행·근거 확인",
};
function empty(key = "work_injury"): LegalPolicy {
  return {
    id: "",
    key,
    version: "",
    effectiveFrom: "",
    effectiveTo: "",
    status: "proposed",
    sourceUrl: "",
    checkedAt: todaySeoul(),
    values: {},
  };
}
export function PolicyPanel({
  admin,
  data,
  reload,
}: {
  admin: boolean;
  data: CaseData;
  reload: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<LegalPolicy>(empty()),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [candidate, setCandidate] = useState<LegalPolicy[] | null>(null);
  const patch = (value: Partial<LegalPolicy>) =>
    setDraft((p) => ({ ...p, ...value }));
  return (
    <details className="private-card">
      <summary>계산 정책과 공식 근거</summary>
      {data.policies.map((p) => (
        <article key={p.id}>
          <b>
            {policyNames[p.key]} · {p.version}
          </b>
          <p>
            {statuses[p.status]} · {p.effectiveFrom} ~ {p.effectiveTo} · 확인{" "}
            {p.checkedAt}
          </p>
          <a href={p.sourceUrl} target="_blank" rel="noreferrer">
            공식 출처
          </a>
          {admin && (
            <button
              className="secondary"
              onClick={() => {
                setDraft({ ...p, id: "", version: "" });
                setMessage(
                  "기존 값이 복사됐습니다. 변경 내용을 확인하고 새 버전 이름으로 저장해 주세요.",
                );
              }}
            >
              이 값으로 새 버전 작성
            </button>
          )}
        </article>
      ))}
      {admin && (
        <>
          <label>
            검증된 정책 파일 불러오기
            <input
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setCandidate(null);
                try {
                  if (file.size > 50000)
                    throw Error("파일은 50KB 이하여야 합니다.");
                  const v = JSON.parse(await file.text());
                  const list =
                    v.version === "cbh-policy/v1" ? v.policies : null;
                  if (
                    !Array.isArray(list) ||
                    !list.length ||
                    list.length > 10 ||
                    !list.every(validPolicy)
                  )
                    throw Error("정책 형식·근거·적용기간을 확인해 주세요.");
                  setCandidate(list);
                } catch (err) {
                  setMessage((err as Error).message);
                }
              }}
            />
          </label>
          {candidate && (
            <section>
              <h3>저장 전 확인</h3>
              {candidate.map((p) => (
                <div key={p.key + p.version}>
                  <b>
                    {policyNames[p.key]} · {p.version}
                  </b>
                  <p>
                    {p.effectiveFrom} ~ {p.effectiveTo} · {statuses[p.status]}
                  </p>
                  <a href={p.sourceUrl} target="_blank" rel="noreferrer">
                    공식 근거 확인
                  </a>
                  <dl>
                    {Object.entries(p.values).map(([k, v]) => (
                      <div key={k}>
                        <dt>{fieldNames[k] ?? k}</dt>
                        <dd>{v.toLocaleString("ko-KR")}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await privateRequest(
                      "private/case/policies/import",
                      "POST",
                      {
                        version: "cbh-policy/v1",
                        policies: candidate,
                        approved: true,
                      },
                    );
                    setCandidate(null);
                    await reload();
                    setMessage("정책을 저장했습니다. 기존 이력은 유지됩니다.");
                  } catch (e) {
                    setMessage((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                검토한 정책 모두 저장
              </button>
              <button className="secondary" onClick={() => setCandidate(null)}>
                취소
              </button>
            </section>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setMessage("");
              if (!validPolicy(draft)) {
                setMessage("필수 값·공식 출처·적용기간을 확인해 주세요.");
                return;
              }
              setBusy(true);
              try {
                await privateRequest("private/case/policies", "POST", {
                  policy: draft,
                });
                setDraft(empty(draft.key));
                await reload();
                setMessage("새 버전을 저장했습니다. 기존 버전은 유지됩니다.");
              } catch (err) {
                setMessage((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h3>정책 직접 입력</h3>
            <label>
              계산 종류
              <select
                value={draft.key}
                onChange={(e) => setDraft(empty(e.target.value))}
              >
                {Object.entries(policyNames).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              버전 이름
              <input
                required
                maxLength={80}
                value={draft.version}
                onChange={(e) => patch({ version: e.target.value })}
                placeholder="확인 날짜와 변경 이유"
              />
            </label>
            <div className="field-grid">
              <label>
                적용 시작일
                <input
                  required
                  type="date"
                  value={draft.effectiveFrom}
                  onChange={(e) => patch({ effectiveFrom: e.target.value })}
                />
              </label>
              <label>
                적용 종료일
                <input
                  required
                  type="date"
                  value={draft.effectiveTo}
                  min={draft.effectiveFrom}
                  onChange={(e) => patch({ effectiveTo: e.target.value })}
                />
              </label>
              <label>
                근거 확인일
                <input
                  required
                  type="date"
                  value={draft.checkedAt}
                  max={todaySeoul()}
                  onChange={(e) => patch({ checkedAt: e.target.value })}
                />
              </label>
              <label>
                시행 상태
                <select
                  value={draft.status}
                  onChange={(e) =>
                    patch({ status: e.target.value as LegalPolicy["status"] })
                  }
                >
                  {Object.entries(statuses).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              공식 근거 주소
              <input
                required
                type="url"
                value={draft.sourceUrl}
                onChange={(e) => patch({ sourceUrl: e.target.value })}
              />
            </label>
            <div className="field-grid">
              {POLICY_FIELDS[draft.key].map((k) => (
                <label key={k}>
                  {fieldNames[k] ?? k}
                  <input
                    type="number"
                    required
                    min={0}
                    step="any"
                    value={draft.values[k] ?? ""}
                    onChange={(e) =>
                      patch({
                        values: {
                          ...draft.values,
                          [k]:
                            e.target.value === ""
                              ? NaN
                              : Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <button disabled={busy}>새 정책 버전 저장</button>
          </form>
        </>
      )}
      <p role="status">{message}</p>
    </details>
  );
}
