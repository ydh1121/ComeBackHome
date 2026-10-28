import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ApiError, privateRequest } from "../../auth/client";
import { PrivateSheet } from "../../shared/PrivateSheet";
import {
  RECORD_SPECS,
  validatePayload,
  type CasePayload,
  type CaseRecord,
  type RecordKind,
  type RecordSpec,
  type Field,
} from "../domain/records";
import type { CaseData } from "./types";
import { fieldText, payloadText } from "./record-text";
export { payloadText } from "./record-text";
export const certaintyLabel = {
  reported: "직접 입력",
  estimated: "예상",
  documented: "문서 확인",
  official: "기관 확정",
};
export function CopyButton({ value }: { value: string }) {
  const [message, setMessage] = useState("복사");
  return (
    <button
      type="button"
      className="secondary copy-button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setMessage("복사됨");
        } catch {
          setMessage("복사 권한 확인");
        }
      }}
    >
      {message}
    </button>
  );
}
export function RecordCard({
  record,
  open,
  data,
}: {
  record: CaseRecord;
  open?: () => void;
  data: CaseData;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    start = useRef({ x: 0, y: 0 });
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  const down = (event: PointerEvent) => {
    if ((event.target as HTMLElement).closest("button,a,input")) return;
    if (!open) return;
    start.current = { x: event.clientX, y: event.clientY };
    cancel();
    timer.current = setTimeout(open, 550);
  };
  const spec: RecordSpec = RECORD_SPECS[record.kind];
  return (
    <article
      className="private-card record-card"
      data-record-id={record.id}
      onPointerDown={down}
      onPointerMove={(e) => {
        if (
          Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) >
          8
        )
          cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
    >
      <div className="record-heading">
        <div>
          <small>
            {spec.title} · {certaintyLabel[record.payload.certainty]}
          </small>
          <h3>{record.payload.title}</h3>
        </div>
        {open && (
          <button className="secondary" onClick={open}>
            편집
          </button>
        )}
      </div>
      <div className="content-scroll">
        <div className="copy-toolbar">
          <CopyButton value={payloadText(record.payload, record.kind, data)} />
        </div>
        <p className="record-body">{record.payload.body || "본문 없음"}</p>
        <dl>
          {spec.fields
            .filter(
              (f) =>
                record.payload.data[f.key] !== undefined &&
                record.payload.data[f.key] !== "",
            )
            .map((f) => (
              <div key={f.key}>
                <dt>{f.label.replace(/ ID$/, "")}</dt>
                <dd>{fieldText(f, record.payload.data[f.key], data)}</dd>
              </div>
            ))}
        </dl>
      </div>
      <small>
        수정{" "}
        {new Date(record.updatedAt).toLocaleString("ko-KR", {
          timeZone: "Asia/Seoul",
        })}{" "}
        · {data.actors.find((a) => a.id === record.updatedBy)?.name ?? "계정"} ·
        버전 {record.revision}
      </small>
    </article>
  );
}
function blank(kind: RecordKind): CasePayload {
  const spec: RecordSpec = RECORD_SPECS[kind];
  return {
    title: "",
    body: "",
    certainty: "reported",
    sourceIds: [],
    data: Object.fromEntries(
      spec.fields.flatMap<[string, string | boolean]>((f) =>
        f.type === "select"
          ? [[f.key, f.options![0][0]]]
          : f.type === "boolean"
            ? [[f.key, false]]
            : [],
      ),
    ),
  };
}
export function RecordEditor({
  record,
  draft,
  kind,
  data,
  close,
  saved,
}: {
  record?: CaseRecord;
  draft?: { id: string; payload: CasePayload };
  kind: RecordKind;
  data: CaseData;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [payload, setPayload] = useState<CasePayload>(
      record ? structuredClone(record.payload) : draft ? structuredClone(draft.payload) : blank(kind),
    ),
    [revision, setRevision] = useState(record?.revision ?? 0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [advanced, setAdvanced] = useState(false),
    [conflict, setConflict] = useState<CaseRecord | null>(null),
    [history, setHistory] = useState<
      Array<{
        revision: number;
        payload: CasePayload;
        authorId: string;
        createdAt: string;
      }>
    >([]);
  const id = useRef(record?.id ?? draft?.id ?? crypto.randomUUID()),
    form = useRef<HTMLFormElement>(null),
    initial = useRef(JSON.stringify(payload));
  const dirty = JSON.stringify(payload) !== initial.current;
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty]);
  const dismiss = () => {
    if (!busy && (!dirty || confirm("저장하지 않은 입력을 취소할까요?"))) close();
  };
  const spec: RecordSpec = RECORD_SPECS[kind];
  const change = (field: Field, value: string | number | boolean) =>
    setPayload((p) => ({ ...p, data: { ...p.data, [field.key]: value } }));
  const input = (field: Field) => {
    const value = payload.data[field.key] ?? "";
    let options: readonly (readonly [string, string])[] | undefined =
      field.options;
    if (
      ["employmentId", "claimId", "relatedId", "relatedMessage"].includes(
        field.key,
      )
    )
      options = data.records
        .filter(
          (r) =>
            !r.archivedAt &&
            r.id !== id.current &&
            (field.key === "employmentId"
              ? r.kind === "employment"
              : field.key === "claimId"
                ? r.kind === "benefit_claim"
                : true),
        )
        .map((r) => [r.id, r.payload.title]);
    if (field.key === "sourceDocument")
      options = data.documents
        .filter((d) => d.status === "ready")
        .map((d) => [d.id, d.filename]);
    if (field.key === "policyId")
      options = data.policies.map((p) => [
        p.id,
        `${p.key} · ${p.version} · ${p.status}`,
      ]);
    if (options)
      return (
        <select
          value={String(value)}
          required={field.required}
          onChange={(e) => change(field, e.target.value)}
        >
          <option value="">선택 안 함</option>
          {options.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      );
    if (field.type === "boolean")
      return (
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => change(field, e.target.checked)}
        />
      );
    if (field.type === "long")
      return (
        <textarea
          value={String(value)}
          rows={4}
          onChange={(e) => change(field, e.target.value)}
        />
      );
    return (
      <input
        type={
          field.type === "number"
            ? "number"
            : field.type === "date"
              ? "date"
              : "text"
        }
        value={String(value)}
        min={field.min}
        max={field.max}
        step={field.type === "number" ? "any" : undefined}
        required={field.required}
        onChange={(e) =>
          change(
            field,
            field.type === "number" && e.target.value !== ""
              ? Number(e.target.value)
              : e.target.value,
          )
        }
      />
    );
  };
  return (
    <PrivateSheet title={spec.title + (record ? " 수정" : " 추가")} onClose={dismiss} onSessionChange={close} busy={busy} closeLabel="편집 닫기" className="record-editor private-sheet--record" scopeClassName="private-page">
        <form
          ref={form}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              validatePayload(kind, payload);
              await privateRequest(
                "private/case/records/" + id.current,
                "PUT",
                { kind, payload, revision },
              );
              await saved();
              close();
            } catch (err) {
              setAdvanced(true);
              setError(
                err instanceof ApiError
                  ? err.message
                  : "입력 항목과 날짜·근거 문서를 확인해 주세요.",
              );
              if (err instanceof ApiError && err.status === 409) {
                try {
                  const latest = await privateRequest<{ record: CaseRecord }>(
                    "private/case/records/" + id.current,
                  );
                  setConflict(latest.record);
                } catch {}
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            제목
            <input
              value={payload.title}
              required
              maxLength={160}
              onChange={(e) =>
                setPayload({ ...payload, title: e.target.value })
              }
            />
          </label>
          <div className="editor-content-scroll">
            <div className="copy-toolbar">
              <CopyButton value={payloadText(payload, kind, data)} />
            </div>
            <label htmlFor={'record-body-'+id.current}>본문·메모</label>
              <textarea
                id={'record-body-'+id.current}
                value={payload.body}
                maxLength={60000}
                rows={14}
                onChange={(e) =>
                  setPayload({ ...payload, body: e.target.value })
                }
              />
          </div>
          <div className="field-grid">
            {spec.fields.filter(f=>f.required||["status","dueDate","from","to","appointmentAt"].includes(f.key)).map(f=><label key={f.key} className={f.type==="boolean"?"auth-check":""}>{f.label.replace(/ ID$/," ")}{f.required?" *":""}{input(f)}</label>)}
          </div>
          <details className="editor-advanced" open={advanced} onToggle={e=>setAdvanced(e.currentTarget.open)}>
            <summary>추가 정보·연결 자료</summary>
            <p className="materials-caption">아는 내용만 입력하세요. 기관 확인 여부와 원본 연결도 여기에서 관리해요.</p>
            <div className="field-grid">{spec.fields.filter(f=>!f.required&&!["status","dueDate","from","to","appointmentAt"].includes(f.key)).map(f=><label key={f.key} className={f.type==="boolean"?"auth-check":""}>{f.label.replace(/ ID$/," ")}{input(f)}</label>)}</div>
          <label>
            확인 수준
            <select
              value={payload.certainty}
              onChange={(e) =>
                setPayload({
                  ...payload,
                  certainty: e.target.value as CasePayload["certainty"],
                })
              }
            >
              {Object.entries(certaintyLabel).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>연결 원본</legend>
            {data.documents.filter((d) => d.status === "ready").length === 0 ? (
              <p>문서 탭에서 원본을 먼저 보관할 수 있습니다.</p>
            ) : (
              data.documents
                .filter((d) => d.status === "ready")
                .map((d) => (
                  <label key={d.id} className="auth-check">
                    <input
                      type="checkbox"
                      checked={payload.sourceIds.includes(d.id)}
                      onChange={(e) =>
                        setPayload({
                          ...payload,
                          sourceIds: e.target.checked
                            ? [...payload.sourceIds, d.id]
                            : payload.sourceIds.filter((i) => i !== d.id),
                        })
                      }
                    />
                    {d.filename}
                  </label>
                ))
            )}
          </fieldset>
          </details>
          <p role="alert">{error}</p>
          {conflict && (
            <section className="conflict-panel">
              <h3>다른 기기의 최신 저장본</h3>
              <pre>{payloadText(conflict.payload, kind, data)}</pre>
              <p>
                내 입력은 보존되어 있습니다. 두 내용을 확인한 뒤 필요한 부분을
                직접 합쳐 주세요.
              </p>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setRevision(conflict.revision);
                  setConflict(null);
                  setError(
                    "최신 버전을 기준으로 저장할 준비가 됐습니다. 내용을 검토한 뒤 저장해 주세요.",
                  );
                }}
              >
                최신본 확인 · 내 입력 계속 편집
              </button>
            </section>
          )}
          <footer>
            <button disabled={busy || !!conflict} type="submit">
              {busy ? "저장 중…" : "저장"}
            </button>
            <button type="button" className="secondary" onClick={dismiss} disabled={busy}>
              취소
            </button>
          </footer>
          {record && (
            <details>
              <summary
                onClick={() => {
                  if (!history.length)
                    void privateRequest<{ history: typeof history }>(
                      "private/case/records/" + id.current + "/history",
                    )
                      .then((v) => setHistory(v.history))
                      .catch((e) => setError(e.message));
                }}
              >
                수정 이력
              </summary>
              {history.map((h) => (
                <section key={h.revision}>
                  <small>
                    버전 {h.revision} ·{" "}
                    {new Date(h.createdAt).toLocaleString("ko-KR")} · 작성자{" "}
                    {data.actors.find((a) => a.id === h.authorId)?.name ??
                      "계정"}
                  </small>
                  <pre>{payloadText(h.payload, kind, data)}</pre>
                </section>
              ))}
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={async () => {
                  if (
                    !confirm(
                      "이 기록을 보관함으로 옮길까요? 수정 이력은 유지됩니다.",
                    )
                  )
                    return;
                  setBusy(true);
                  try {
                    await privateRequest(
                      "private/case/records/" + id.current,
                      "DELETE",
                      { revision },
                    );
                    await saved();
                    close();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                기록 보관
              </button>
            </details>
          )}
        </form>
    </PrivateSheet>
  );
}
