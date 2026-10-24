import { useState } from "react";
import { privateRequest } from "../../auth/client";
import { summarizeLedger } from "../domain/calculations";
import { todaySeoul } from "../domain/dates";
import type { CaseData } from "./types";
export const money = (value: number | null) =>
  value === null ? "미입력" : Math.round(value).toLocaleString("ko-KR") + "원";
export function PaymentsPanel({
  data,
  reload,
}: {
  data: CaseData;
  reload: () => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [type, setType] = useState("decision"),
    [claimId, setClaimId] = useState("");
  const claims = data.records.filter(
      (r) => r.kind === "benefit_claim" && !r.archivedAt,
    ),
    sources = data.records.filter(
      (r) =>
        r.payload.sourceIds.length &&
        !r.archivedAt &&
        (["decision", "decision_adjustment"].includes(type)
          ? r.payload.certainty === "official"
          : ["documented", "official"].includes(r.payload.certainty)),
    );
  return (
    <section>
      <h2>지급장부</h2>
      {claims.map((claim) => {
        const d = claim.payload.data,
          events = data.payments.filter((e) => e.claim_id === claim.id);
        const sum = summarizeLedger(
          {
            benefitType: String(d.benefitType),
            dailyRate: typeof d.dailyRate === "number" ? d.dailyRate : null,
            allocatedDays:
              typeof d.allocatedDays === "number" ? d.allocatedDays : null,
            expectedAmount:
              typeof d.expectedAmount === "number" ? d.expectedAmount : null,
            officialRemainingDays:
              typeof d.officialRemainingDays === "number"
                ? d.officialRemainingDays
                : null,
          },
          events.map((e) => ({
            id: e.id,
            eventType: e.event_type,
            amount: e.amount,
            recognizedDays: e.recognized_days,
          })),
        );
        return (
          <article className="private-card" key={claim.id}>
            <h3>{claim.payload.title}</h3>
            <dl className="ledger-grid">
              {(
                [
                  ["예상 총액", money(sum.expectedTotal)],
                  ["기관 지급결정액", money(sum.approvedTotal)],
                  ["실제 입금액", money(sum.actualPaid)],
                  ["결정 후 미입금", money(sum.approvedOutstanding)],
                  ["남은 조건부 예상액", money(sum.conditionalRemaining)],
                  ["기관 인정일수", sum.recognizedDays + "일"],
                  [
                    "잔여일수",
                    sum.remainingDays === null
                      ? "미산정"
                      : sum.remainingDays + "일",
                  ],
                  ["법정 수급기간 만료일", String(d.expiresAt ?? "미입력")],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {sum.needsReconciliation || sum.overpayment > 0 ? (
              <p role="alert">
                결정·입금·인정일수가 맞지 않습니다. 정정 내역을 확인해 주세요.
              </p>
            ) : null}
            <details>
              <summary>지급·정정 내역 {events.length}건</summary>
              {events.map((e) => (
                <p key={e.id}>
                  {e.event_date} · {e.dedupe_key} · {money(e.amount)} ·{" "}
                  {e.recognized_days}일
                </p>
              ))}
            </details>
          </article>
        );
      })}
      {!claims.length ? (
        <p className="empty-state">
          급여 청구·수급자격 기록을 추가하면 예상과 실제 지급을 나누어 볼 수
          있습니다.
        </p>
      ) : (
        <details className="private-card">
          <summary>지급결정·입금·정정 추가</summary>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = e.currentTarget,
                d = new FormData(f);
              setBusy(true);
              setError("");
              try {
                await privateRequest("private/case/payments", "POST", {
                  claimId,
                  eventType: type,
                  amount: Number(d.get("amount")),
                  recognizedDays: ["deposit", "refund"].includes(type)
                    ? 0
                    : Number(d.get("days")),
                  eventDate: d.get("date"),
                  sourceRecordId: d.get("source"),
                  correctsId: d.get("corrects"),
                  reference: d.get("reference"),
                });
                f.reset();
                await reload();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              급여 청구
              <select
                value={claimId}
                required
                onChange={(e) => setClaimId(e.target.value)}
              >
                <option value="">선택</option>
                {claims.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.payload.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              내역 종류
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="decision">기관 지급결정</option>
                <option value="deposit">실제 입금</option>
                <option value="decision_adjustment">결정액·일수 정정</option>
                <option value="refund">입금액 반환</option>
              </select>
            </label>
            <label>
              금액 (정정은 증감액)
              <input
                name="amount"
                type="number"
                step="1"
                min={type === "decision_adjustment" ? -100000000000 : 0}
                required
              />
            </label>
            {!["deposit", "refund"].includes(type) && (
              <label>
                인정일수 (정정은 증감일)
                <input
                  name="days"
                  type="number"
                  step="1"
                  min={type === "decision_adjustment" ? -1500 : 0}
                  max={1500}
                  defaultValue={0}
                />
              </label>
            )}
            <label>
              내역 날짜
              <input
                name="date"
                type="date"
                defaultValue={todaySeoul()}
                required
              />
            </label>
            <label>
              원본을 연결한 근거 기록
              <select name="source" required>
                <option value="">선택</option>
                {sources.map((r) => (
                  <option value={r.id} key={r.id}>
                    {r.payload.title}
                  </option>
                ))}
              </select>
            </label>
            {["refund", "decision_adjustment"].includes(type) && (
              <label>
                정정할 이전 내역
                <select name="corrects" required>
                  <option value="">선택</option>
                  {data.payments
                    .filter(
                      (p) =>
                        p.claim_id === claimId &&
                        (type === "refund"
                          ? p.event_type === "deposit"
                          : ["decision", "decision_adjustment"].includes(
                              p.event_type,
                            )),
                    )
                    .map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.event_date} · {p.dedupe_key}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label>
              중복 확인용 결정·거래 번호
              <input name="reference" minLength={3} maxLength={150} required />
            </label>
            <p>
              같은 번호·내용은 한 번만 저장됩니다. 정정은 이전 내역을 남기고
              추가합니다.
            </p>
            <button disabled={busy}>내역 저장</button>
            <p role="alert">{error}</p>
          </form>
        </details>
      )}
    </section>
  );
}
