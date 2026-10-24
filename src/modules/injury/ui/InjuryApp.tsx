import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthRoot";
import { privateRequest } from "../../auth/client";
import {
  RECORD_SPECS,
  type RecordKind,
  type CaseRecord,
} from "../domain/records";
import { RecordCard, RecordEditor } from "./RecordEditor";
import { DocumentsPanel } from "./DocumentsPanel";
import { PaymentsPanel } from "./PaymentsPanel";
import { PolicyPanel } from "./PolicyPanel";
import { CalculationsPanel } from "./CalculationsPanel";
import type { CaseData } from "./types";

const tabs = [
  ["tasks", "할 일"],
  ["claim", "산재·요양"],
  ["employment", "직장"],
  ["payments", "지급"],
  ["documents", "문서·메모"],
  ["settings", "접근·이력"],
] as const;
type Section = (typeof tabs)[number][0];
const actions: Record<string, string> = {
  treatment_consult: "진료계획 상담",
  plan_prepare: "진료계획 준비",
  plan_receipt: "공단 수신 확인",
  employer_reply: "사업주 의견 회신",
  appeal: "불복 기한 확인",
  expiry: "수급기간 만료",
  appointment: "예약·인정일",
  task: "진행할 일",
  receipt_check: "접수번호·실제 접수 확인",
  progress_inquiry: "공단 진행상태 문의",
  benefit_prepare: "취업불능 기간·휴업급여 청구 확인",
  expense_check: "본인부담 치료비 청구 가능 여부 확인",
  disability_check: "치료종결 후 잔존 장해 검토",
};
interface Consent {
  owner: boolean;
  adminAccess: boolean;
  consent: null | {
    admin_access: number;
    purpose: string;
    retention: string;
    revision: number;
    updated_at: string;
  };
}
export function InjuryApp() {
  const auth = useAuth(),
    [data, setData] = useState<CaseData | null>(null),
    [consent, setConsent] = useState<Consent | null>(null),
    [section, setSection] = useState<Section>(() => {
      const value = new URLSearchParams(location.search).get("section");
      return tabs.some((t) => t[0] === value) ? (value as Section) : "tasks";
    }),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<{
      kind: RecordKind;
      record?: CaseRecord;
    } | null>(null),
    [query, setQuery] = useState(""),
    [kind, setKind] = useState<RecordKind>(
      () =>
        (Object.entries(RECORD_SPECS).find(
          ([, spec]) =>
            spec.group === new URLSearchParams(location.search).get("section"),
        )?.[0] ?? "task") as RecordKind,
    ),
    [archived, setArchived] = useState(false);
  const reload = useCallback(async () => {
    try {
      const c = await privateRequest<Consent>("private/case/consent");
      setConsent(c);
      if (!c.owner && !c.adminAccess) {
        setData(null);
        return;
      }
      setData(await privateRequest<CaseData>("private/case"));
      setError("");
    } catch (e) {
      setData(null);
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [reload]);
  const choose = (value: Section) => {
    setSection(value);
    setQuery("");
    setArchived(false);
    const next = Object.entries(RECORD_SPECS).find(
      ([, spec]) => spec.group === value,
    )?.[0];
    if (next) setKind(next as RecordKind);
    history.replaceState(null, "", "/injury?section=" + value);
  };
  const records =
    data?.records.filter(
      (r) =>
        RECORD_SPECS[r.kind].group === section &&
        !!r.archivedAt === archived &&
        (!query ||
          [r.payload.title, r.payload.body].some((t) =>
            t.toLowerCase().includes(query.toLowerCase()),
          )),
    ) ?? [];
  return (
    <main className="private-page" data-page="InjuryApp">
      <header className="private-header">
        <a href="/">ComeBackHome</a>
        <a href="/account">내 계정</a>
      </header>
      <div className="private-title">
        <div>
          <span>나의 자료 관리</span>
          <h1>산재·직장</h1>
        </div>
        <button className="secondary" onClick={() => void reload()}>
          새로고침
        </button>
      </div>
      <nav className="private-tabs" aria-label="산재 메뉴">
        {tabs.map(([value, title]) => (
          <button
            key={value}
            aria-current={section === value ? "page" : undefined}
            onClick={() => choose(value)}
          >
            {title}
          </button>
        ))}
      </nav>
      {error && (
        <p className="private-card" role="alert">
          {error}
        </p>
      )}
      {!data && !error && consent && !consent.owner && !consent.adminAccess && (
        <section className="private-card">
          <h2>열람 동의가 필요합니다</h2>
          <p>
            신이본 계정의 접근·이력 탭에서 관리자 열람을 허용하면 자료를 볼 수
            있습니다.
          </p>
        </section>
      )}
      {!data && !error && !consent && <p role="status">자료를 불러오는 중…</p>}
      {section === "settings" && consent && (
        <ConsentPanel consent={consent} reload={reload} />
      )}
      {data && (
        <>
          {section === "tasks" && (
            <section className="private-card">
              <h2>확인할 기한</h2>
              {data.deadlines.length ? (
                data.deadlines.map((d) => (
                  <button
                    className={"deadline-row " + (d.overdue ? "overdue" : "")}
                    key={d.id}
                    onClick={() => {
                      const record = data.records.find(
                        (r) => r.id === d.recordId,
                      );
                      if (record) setEditing({ kind: record.kind, record });
                    }}
                  >
                    <span>
                      {d.date}
                      <small>
                        {d.kind === "recommended"
                          ? "권장"
                          : d.kind === "legal_check"
                            ? "법정기한 확인 필요"
                            : "입력한 기관 일정"}
                      </small>
                    </span>
                    <b>
                      {actions[d.action]}
                      <small>
                        {
                          data.records.find((r) => r.id === d.recordId)?.payload
                            .title
                        }
                      </small>
                    </b>
                  </button>
                ))
              ) : (
                <p>등록한 기한이 없습니다.</p>
              )}
              {data.overlaps.length > 0 && (
                <p role="alert">
                  산재 휴업급여와 구직급여 기간이 겹치는 기록이 있습니다. 기관에
                  확인해 주세요.
                </p>
              )}
            </section>
          )}
          {section === "documents" && (
            <DocumentsPanel data={data} reload={reload} />
          )}{" "}
          {section === "payments" && (
            <PaymentsPanel data={data} reload={reload} />
          )}{" "}
          {["employment", "payments"].includes(section) && (
            <CalculationsPanel data={data} />
          )}
          {section !== "settings" && (
            <>
              <div className="record-tools">
                <label>
                  찾기
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="제목·본문 검색"
                  />
                </label>
                <label className="auth-check">
                  <input
                    type="checkbox"
                    checked={archived}
                    onChange={(e) => setArchived(e.target.checked)}
                  />
                  보관 기록
                </label>
              </div>
              <div className="record-add">
                <label>
                  기록 종류
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as RecordKind)}
                  >
                    {Object.entries(RECORD_SPECS)
                      .filter(([, spec]) => spec.group === section)
                      .map(([value, spec]) => (
                        <option key={value} value={value}>
                          {spec.title}
                        </option>
                      ))}
                  </select>
                </label>
                <button onClick={() => setEditing({ kind })}>기록 추가</button>
              </div>
              <div className="record-grid">
                {records.map((record) =>
                  archived ? (
                    <div key={record.id}>
                      <RecordCard record={record} data={data} />
                      <button
                        className="secondary"
                        onClick={async () => {
                          try {
                            await privateRequest(
                              "private/case/records/" + record.id + "/restore",
                              "POST",
                              { revision: record.revision },
                            );
                            await reload();
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        보관 기록 복원
                      </button>
                    </div>
                  ) : (
                    <RecordCard
                      key={record.id}
                      record={record}
                      data={data}
                      open={() => setEditing({ kind: record.kind, record })}
                    />
                  ),
                )}
              </div>
              {!records.length && (
                <p className="empty-state">이곳에 등록한 기록이 없습니다.</p>
              )}
            </>
          )}
          {section === "settings" && (
            <>
              <AuditPanel />
              <PolicyPanel
                admin={auth.user?.role === "admin"}
                data={data}
                reload={reload}
              />
              <DataTransfer data={data} reload={reload} />
            </>
          )}
        </>
      )}
      {editing && data && (
        <RecordEditor
          key={editing.record?.id ?? editing.kind}
          {...editing}
          data={data}
          close={() => setEditing(null)}
          saved={reload}
        />
      )}
    </main>
  );
}
function ConsentPanel({
  consent,
  reload,
}: {
  consent: Consent;
  reload: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  if (!consent.owner)
    return (
      <section className="private-card">
        <h2>자료 접근권한</h2>
        <p>
          신이본 계정에 귀속된 자료입니다. 관리자 열람:{" "}
          {consent.adminAccess ? "허용됨" : "허용 안 됨"}
        </p>
      </section>
    );
  return (
    <section className="private-card">
      <h2>관리자 열람 동의</h2>
      <p>
        내 자료를 관리자가 함께 읽고 수정하도록 허용합니다. 동의를 철회해도
        원본과 수정 이력은 유지됩니다.
      </p>
      <form
        key={consent.consent?.revision}
        onSubmit={async (e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          try {
            await privateRequest("private/case/consent", "PUT", {
              adminAccess: d.get("allow") === "on",
              purpose: d.get("purpose"),
              retention: d.get("retention"),
              revision: consent.consent?.revision ?? 0,
            });
            await reload();
            setError("저장했습니다.");
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <label>
          함께 관리하는 목적
          <input
            name="purpose"
            maxLength={500}
            defaultValue={consent.consent?.purpose ?? ""}
          />
        </label>
        <label>
          자료 보관·검토 기간
          <input
            name="retention"
            maxLength={300}
            defaultValue={consent.consent?.retention ?? ""}
          />
        </label>
        <label className="auth-check">
          <input
            name="allow"
            type="checkbox"
            defaultChecked={!!consent.consent?.admin_access}
          />
          관리자의 읽기·수정 허용
        </label>
        <button>동의 설정 저장</button>
        <p role="status">{error}</p>
      </form>
    </section>
  );
}
function AuditPanel() {
  const [events, setEvents] = useState<
      Array<{
        actor_id: string;
        action: string;
        created_at: string;
        outcome: string;
      }>
    >([]),
    [error, setError] = useState("");
  return (
    <details className="private-card">
      <summary
        onClick={() =>
          void privateRequest<{ events: typeof events }>("private/case/audit")
            .then((v) => setEvents(v.events))
            .catch((e) => setError(e.message))
        }
      >
        접근·수정 감사 이력
      </summary>
      <p role="alert">{error}</p>
      {events.map((e, i) => (
        <p key={i}>
          {new Date(e.created_at).toLocaleString("ko-KR")} · {e.actor_id} ·{" "}
          {e.action} · {e.outcome}
        </p>
      ))}
    </details>
  );
}
function DataTransfer({
  data,
  reload,
}: {
  data: CaseData;
  reload: () => Promise<void>;
}) {
  const [candidate, setCandidate] = useState<{
      version: string;
      records: Array<{ kind: RecordKind; payload: unknown }>;
    } | null>(null),
    [error, setError] = useState("");
  return (
    <details className="private-card">
      <summary>내 자료 내보내기·기획 자료 가져오기</summary>
      <button
        className="secondary"
        onClick={async () => {
          try {
            const body = await privateRequest("private/case/export"),
              url = URL.createObjectURL(
                new Blob([JSON.stringify(body, null, 2)], {
                  type: "application/json",
                }),
              );
            const a = document.createElement("a");
            a.href = url;
            a.download = "ComeBackHome-private-case.json";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        내 자료 JSON 내려받기
      </button>
      <label>
        검토할 기획 자료 JSON
        <input
          type="file"
          accept="application/json,.json"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            try {
              if (file.size > 180000)
                throw Error("한 번에 180KB 이하 자료를 선택해 주세요.");
              const parsed = JSON.parse(await file.text());
              if (
                parsed.version !== "cbh-case-seed/v1" ||
                !Array.isArray(parsed.records) ||
                parsed.records.length > 80
              )
                throw Error("기획 자료 형식을 확인해 주세요.");
              setCandidate(parsed);
              setError("");
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        />
      </label>
      {candidate && (
        <>
          <p>
            새 기록 {candidate.records.length}건. 기존 {data.records.length}건은
            덮어쓰지 않습니다.
          </p>
          <pre className="import-preview">
            {JSON.stringify(candidate.records, null, 2)}
          </pre>
          <button
            onClick={async () => {
              try {
                await privateRequest("private/case/import", "POST", {
                  ...candidate,
                  approved: true,
                });
                setCandidate(null);
                await reload();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            검토 완료 · 새 기록으로 저장
          </button>
          <button className="secondary" onClick={() => setCandidate(null)}>
            취소
          </button>
        </>
      )}
      <p role="alert">{error}</p>
    </details>
  );
}
