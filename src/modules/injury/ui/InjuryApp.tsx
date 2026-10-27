import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthRoot";
import { privateRequest } from "../../auth/client";
import {
  RECORD_SPECS,
  type RecordKind,
  type CaseRecord,
} from "../domain/records";
import { RecordCard, RecordEditor } from "./RecordEditor";
import { DocumentsPanel } from "./DocumentsPanel";
import { ManageHome, managementSections } from "../materials/ManageHome";
import { PaymentsPanel } from "./PaymentsPanel";
import { PolicyPanel } from "./PolicyPanel";
import { CalculationsPanel } from "./CalculationsPanel";
import type { CaseData } from "./types";
import { reviewCaseSeed, type CaseSeed } from "../domain/imports";
import { AdvisorHelp, AdvisorHome, AdvisorProgress } from "../advisor/AdvisorHome";
import { isProfile } from "../advisor/model";
import { Icon } from "../../../shared/components/Icon";

const tabs = [
  ["tasks", "할 일"],
  ["claim", "산재·요양"],
  ["employment", "직장"],
  ["payments", "지급"],
  ["documents", "문서·메모"],
  ["settings", "접근·이력"],
] as const;
type Section = (typeof tabs)[number][0] | "overview";
type AdvisorRoute = "today" | "progress" | "library" | "manage" | "help";
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
    [view, setView] = useState<AdvisorRoute>(() => {
      const value=new URLSearchParams(location.search).get("section");
      return value === "documents" ? "library" : value === "manage" || tabs.some(([key])=>key===value) ? "manage" : ["progress","library","help"].includes(value ?? "") ? value as AdvisorRoute : "today";
    }),
    [section, setSection] = useState<Section>(() => {
      const value = new URLSearchParams(location.search).get("section");
      return tabs.some((t) => t[0] === value) ? (value as Section) : "overview";
    }),
    [pageKey, setPageKey] = useState(0),
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
    setView(value === "documents" ? "library" : "manage");
    setSection(value);
    setQuery("");
    setArchived(false);
    const next = Object.entries(RECORD_SPECS).find(
      ([, spec]) => spec.group === value,
    )?.[0];
    if (next) setKind(next as RecordKind);
    history.replaceState(null, "", "/injury?section=" + value);
  };
  const navigate = (value: AdvisorRoute) => {
    setPageKey(key => key + 1);
    if(value === "manage") { choose("overview"); history.replaceState(null,"","/injury?section=manage"); }
    else { setView(value);history.replaceState(null,"","/injury?section="+value); }
    window.scrollTo(0,0);
  };
  const records =
    data?.records.filter(
      (r) =>
        !isProfile(r) &&
        RECORD_SPECS[r.kind].group === section &&
        !!r.archivedAt === archived &&
        (!query ||
          [r.payload.title, r.payload.body].some((t) =>
            t.toLowerCase().includes(query.toLowerCase()),
          )),
    ) ?? [];
  return (
    <main className="private-page advisor-shell" data-page="InjuryApp" data-advisor-view={view}>
      <header className="private-header">
        <a href="/">ComeBackHome</a>
        <a href="/account">내 계정</a>
      </header>
      <div className="private-title">
        <div>
          <span className="advisor-brand-caption">치료 · 신청 · 생활비</span><h1>산재 도우미</h1>
        </div>
        <button className="secondary advisor-refresh" onClick={() => void reload()} aria-label="새로고침" title="새로고침"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 11-1l3 4M4 14l3 4a7 7 0 0 0 11-1"/></svg></button>
      </div>

      <nav className="private-tabs advisor-top-nav" aria-label="산재 메뉴">
        {([["today","오늘"],["progress","진행 상황"],["library","내 자료"]] as const).map(([key,title])=><button key={key} aria-current={view===key?"page":undefined} onClick={()=>navigate(key)}>{title}</button>)}
      </nav>
      <div className="advisor-utilities"><button onClick={()=>navigate("help")}>상황별 도움말</button><button onClick={()=>navigate("manage")}>내 관리함<Icon name="chevron-right"/></button></div>
      {view === "manage" && section !== "overview" && <div className="management-section-head"><button className="secondary" onClick={()=>navigate("manage")}><Icon name="chevron-left"/>내 관리함으로</button><h2>{managementSections.find(s=>s.id===section)?.title??"자료 설정"}</h2></div>}
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
      {view === "manage" && section === "settings" && consent && (
        <ConsentPanel consent={consent} reload={reload} />
      )}
      {data && view === "today" && <AdvisorHome key={pageKey} data={data} reload={reload} navigate={navigate}/>}
      {data && view === "progress" && <AdvisorProgress data={data} navigate={navigate}/>}
      {data && view === "library" && <DocumentsPanel data={data} reload={reload} openRecord={record=>setEditing({kind:record.kind,record})} createRecord={kind=>setEditing({kind})}/>}
      {data && view === "manage" && section === "overview" && <ManageHome data={data} choose={choose}/>}

      {data && view === "help" && <AdvisorHelp onOpen={id=>{ navigate("today"); history.replaceState(null,"","/injury?section=today&action="+id); }}/>}
      {data && view === "manage" && section !== "overview" && (
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
          {section === "payments" && (
            <PaymentsPanel data={data} reload={reload} />
          )}{" "}
          {["employment", "payments"].includes(section) && (
            <details className="private-card management-calculator"><summary>기간·예상금액 계산 도구</summary><CalculationsPanel data={data} /></details>
          )}
          {section !== "settings" && section !== "documents" && (
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
              <div className="management-add-row"><button onClick={()=>setEditing({kind})}><Icon name="plus"/>기록 추가</button><small>{RECORD_SPECS[kind].title}</small></div>
              <details className="management-kinds"><summary>다른 종류의 기록 추가</summary><div className="management-kind-list">{Object.entries(RECORD_SPECS).filter(([,spec])=>spec.group===section).map(([value,spec])=><button className="secondary" key={value} onClick={()=>{setKind(value as RecordKind);setEditing({kind:value as RecordKind});}}>{spec.title}<Icon name="chevron-right"/></button>)}</div></details>
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
  const [candidate, setCandidate] = useState<CaseSeed | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const selection = useRef(0);
  useEffect(
    () => () => {
      selection.current++;
    },
    [],
  );
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
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const ticket = ++selection.current;
            setCandidate(null);
            setError("");
            try {
              if (file.size > 180000)
                throw Error("한 번에 180KB 이하 자료를 선택해 주세요.");
              const parsed = reviewCaseSeed(JSON.parse(await file.text()));
              if (ticket === selection.current) setCandidate(parsed);
            } catch (err) {
              if (ticket === selection.current)
                setError(
                  file.size > 180000
                    ? (err as Error).message
                    : "기획 자료의 형식·내용을 확인해 주세요. 저장하지 않았습니다.",
                );
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
          <p>
            아래 내용을 펼쳐 확인한 뒤 저장하세요. 파일을 선택한 것만으로는
            저장되지 않습니다.
          </p>
          <div className="seed-preview" aria-label="가져올 기록 미리보기">
            {candidate.records.map((record, index) => (
              <details key={index}>
                <summary>{record.payload.title}</summary>
                <small>
                  {RECORD_SPECS[record.kind].title} ·{" "}
                  {
                    {
                      reported: "본인 진술·초안",
                      estimated: "예상",
                      documented: "문서 근거",
                      official: "기관 확인",
                    }[record.payload.certainty]
                  }
                </small>
                <p className="record-body">
                  {record.payload.body || "본문 없음"}
                </p>
                <dl>
                  {RECORD_SPECS[record.kind].fields
                    .filter(
                      (field) =>
                        record.payload.data[field.key] !== undefined &&
                        record.payload.data[field.key] !== "",
                    )
                    .map((field) => {
                      const value = record.payload.data[field.key];
                      return (
                        <div key={field.key}>
                          <dt>{field.label}</dt>
                          <dd>
                            {field.options?.find(
                              (option) => option[0] === value,
                            )?.[1] ??
                              (typeof value === "boolean"
                                ? value
                                  ? "예"
                                  : "아니요"
                                : String(value))}
                          </dd>
                        </div>
                      );
                    })}
                </dl>
              </details>
            ))}
          </div>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await privateRequest("private/case/import", "POST", {
                  ...candidate,
                  approved: true,
                });
                setCandidate(null);
                await reload();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            검토 완료 · 새 기록으로 저장
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => setCandidate(null)}
          >
            취소
          </button>
        </>
      )}
      <p role="alert">{error}</p>
    </details>
  );
}
