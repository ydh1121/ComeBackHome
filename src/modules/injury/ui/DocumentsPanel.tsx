import { useEffect, useRef, useState } from "react";
import { privateRequest, ApiError } from "../../auth/client";
import type { CaseData } from "./types";
import { driveConnectionNotice } from "../domain/drive-connection";
const base = "private/case/documents";
declare global {
  interface Window {
    gapi?: {
      load: (
        name: string,
        options: { callback: () => void; onerror: () => void },
      ) => void;
    };
    google?: { picker: PickerApi };
  }
}
interface PickerApi {
  DocsView: new (view: unknown) => {
    setIncludeFolders: (value: boolean) => unknown;
    setSelectFolderEnabled: (v: boolean) => unknown;
    setMimeTypes: (v: string) => unknown;
  };
  ViewId: { FOLDERS: unknown };
  PickerBuilder: new () => {
    setDeveloperKey: (key: string) => unknown;
    setAppId: (id: string) => unknown;
    setOAuthToken: (token: string) => unknown;
    addView: (view: unknown) => unknown;
    setCallback: (
      fn: (data: { action: string; docs?: Array<{ id: string }> }) => void,
    ) => unknown;
    setOrigin: (origin: string) => unknown;
    build: () => { setVisible: (v: boolean) => void };
  };
  Action: { PICKED: string; CANCEL: string };
}
async function loadPicker() {
  if (window.google?.picker) return;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.onload = () =>
      window.gapi?.load("picker", {
        callback: resolve,
        onerror: () => reject(Error("폴더 선택기를 열지 못했습니다.")),
      });
    script.onerror = () => reject(Error("폴더 선택기를 불러오지 못했습니다."));
    document.head.append(script);
  });
}
export function DocumentsPanel({
  data,
  reload,
}: {
  data: CaseData;
  reload: () => Promise<void>;
}) {
  const [status, setStatus] = useState<{
      configured: boolean;
      owner: boolean;
      connected: boolean;
      folderSelected: boolean;
    } | null>(null),
    [message, setMessage] = useState(() => driveConnectionNotice(new URLSearchParams(location.search).get("drive"))),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [file, setFile] = useState<File | null>(null),
    [handoff, setHandoff] = useState("");
  const controller = useRef<AbortController | null>(null);
  const connecting = useRef(false);
  const connect = async () => {
    if (connecting.current) return;
    connecting.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await privateRequest<{ url: string }>(base + "/oauth/start", "POST", {});
      location.assign(result.url);
    } catch (error) { setMessage((error as Error).message); }
    finally { connecting.current = false; setBusy(false); }
  };
  const refresh = () =>
    privateRequest<NonNullable<typeof status>>(base + "/status").then(
      setStatus,
    );
  useEffect(() => {
    void refresh().catch((e) => setMessage(e.message));
    return () => {
      controller.current?.abort();
      controller.current = null;
    };
  }, []);
  const folder = async () => {
    setBusy(true);
    try {
      await loadPicker();
      const config = await privateRequest<{
          accessToken: string;
          apiKey: string;
          appId: string;
        }>(base + "/picker", "POST", {}),
        api = window.google!.picker;
      const view = new api.DocsView(api.ViewId.FOLDERS);
      view.setIncludeFolders(true);
      view.setSelectFolderEnabled(true);
      view.setMimeTypes("application/vnd.google-apps.folder");
      const builder = new api.PickerBuilder();
      builder.setDeveloperKey(config.apiKey);
      builder.setAppId(config.appId);
      builder.setOAuthToken(config.accessToken);
      builder.setOrigin(location.origin);
      builder.addView(view);
      builder.setCallback((result) => {
        if (result.action === api.Action.PICKED && result.docs?.[0])
          void privateRequest(base + "/folder", "PUT", {
            folderId: result.docs[0].id,
          })
            .then(refresh)
            .catch((e) => setMessage(e.message));
      });
      builder.build().setVisible(true);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const upload = async () => {
    if (!file) return;
    const activeFile = file,
      abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setMessage("원본 확인 중…");
    setProgress(0);
    try {
      if (activeFile.size > 20 * 1024 * 1024)
        throw Error("파일은 최대 20MB까지 선택할 수 있습니다.");
      const buffer = await activeFile.arrayBuffer(),
        hash = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
        )
          .map((v) => v.toString(16).padStart(2, "0"))
          .join("");
      if (abort.signal.aborted) throw new DOMException("취소", "AbortError");
      const item = await privateRequest<{ id: string; status: string }>(
        base,
        "POST",
        {
          filename: activeFile.name,
          mime: activeFile.type,
          bytes: activeFile.size,
          sha256: hash,
        },
        abort.signal,
      );
      if (item.status === "trashed")
        throw Error("보관함에 같은 원본이 있습니다. 복원 버튼을 눌러 주세요.");
      if (item.status !== "ready") {
        let state = await privateRequest<{ offset: number; complete: boolean }>(
          base + "/" + item.id + "/upload",
          "POST",
          {},
          abort.signal,
        );
        while (!state.complete) {
          setMessage("비공개 Drive에 보관 중…");
          const end = Math.min(state.offset + 1024 * 1024, activeFile.size);
          const response = await fetch(
            "/api/" + base + "/" + item.id + "/upload?offset=" + state.offset,
            {
              method: "PUT",
              headers: { "Content-Type": activeFile.type },
              body: activeFile.slice(state.offset, end),
              credentials: "same-origin",
              cache: "no-store",
              signal: abort.signal,
            },
          );
          const result = await response.json();
          if (!response.ok) throw new ApiError(result.error, response.status);
          if (result.offset <= state.offset)
            throw Error(
              "전송이 진행되지 않습니다. 같은 파일로 재시도해 주세요.",
            );
          state = result;
          setProgress(Math.round((state.offset / activeFile.size) * 100));
        }
        setMessage("크기·무결성·비공개 권한 확인 중…");
        await privateRequest(
          base + "/" + item.id + "/verify",
          "POST",
          {},
          abort.signal,
        );
      }
      setFile(null);
      setMessage("원본 보관 확인 완료");
      await reload();
    } catch (e) {
      setMessage(
        abort.signal.aborted
          ? "취소했습니다. 파일을 다시 선택하면 전송 상태를 확인하고 이어갑니다."
          : (e as Error).message,
      );
      await reload().catch(() => {});
    } finally {
      setBusy(false);
      controller.current = null;
    }
  };
  const action = async (path: string, method = "POST") => {
    try {
      setBusy(true);
      const result = await privateRequest<{ url?: string; sha256?: string }>(
        path,
        method,
        method === "POST" ? {} : undefined,
      );
      if (result.url)
        setHandoff(
          `${result.url}\n원본 SHA-256: ${result.sha256}\n\n분석 요청: `,
        );
      await reload();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="document-panel">
      <div className="private-card">
        <h2>원본 문서</h2>
        {!status ? (
          <p>보관 연결 확인 중…</p>
        ) : !status.configured ? (
          <p>
            관리자가 Google Drive 연결 설정을 적용하면 사용할 수 있습니다.
            원본을 지금 제출할 필요는 없습니다.
          </p>
        ) : (
          <>
            <p>
              {status.folderSelected
                ? "비공개 Drive 보관 폴더가 연결돼 있습니다."
                : status.connected
                  ? "Google 계정이 연결돼 있습니다. 보관 폴더 선택을 완료해 주세요."
                  : "원본을 보관할 Google 계정을 연결한 뒤 비공개 보관 폴더를 선택해 주세요."}
            </p>
            {status.owner && (
              <div className="private-actions">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void connect()}
                >
                  {status.connected
                    ? "Google 계정 다시 연결"
                    : "Google Drive 연결"}
                </button>
                {status.connected && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void folder()}
                  >
                    보관 폴더 선택
                  </button>
                )}
              </div>
            )}
            {status.folderSelected && (
              <>
                <label className="file-picker">
                  PDF·PNG·JPG·WebP · 최대 20MB
                  <input
                    type="file"
                    accept="application/pdf,image/png,image/jpeg,image/webp"
                    disabled={busy}
                    onChange={(e) => {
                      setFile(e.target.files?.[0] ?? null);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
                {file && <p>{file.name}</p>}
                <div className="private-actions">
                  <button
                    disabled={busy || !file}
                    onClick={() => void upload()}
                  >
                    원본 보관
                  </button>
                  {busy && (
                    <button
                      className="secondary"
                      onClick={() => controller.current?.abort()}
                    >
                      전송 취소
                    </button>
                  )}
                </div>
                {busy && <progress value={progress} max={100} />}
              </>
            )}
          </>
        )}
        <p role="status">{message}</p>
      </div>
      <div className="document-list">
        {data.documents.map((d) => (
          <article className="private-card" key={d.id}>
            <h3>{d.filename}</h3>
            <p>
              {(
                {
                  ready: "보관 확인 완료",
                  pending: "전송 대기",
                  uploading: "전송 중·같은 파일로 재시도",
                  verifying: "원본 확인 중",
                  failed: "원본 재확인 필요",
                  missing: "원본 찾기 필요",
                  trashed: "보관함",
                } as Record<string, string>
              )[d.status] ?? d.status}{" "}
              · {Math.ceil(d.bytes / 1024)} KB
            </p>
            <div className="private-actions">
              {d.status === "ready" ? (
                <>
                  <a
                    className="private-button secondary"
                    href={"/api/" + base + "/" + d.id + "/download"}
                    download
                  >
                    원본 다운로드
                  </a>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void action(base + "/" + d.id + "/handoff", "GET")
                    }
                  >
                    ChatGPT 분석 요청 준비
                  </button>
                </>
              ) : (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void action(
                      base +
                        "/" +
                        d.id +
                        (d.status === "trashed" ? "/restore" : "/verify"),
                    )
                  }
                >
                  {d.status === "trashed"
                    ? "원본 확인 후 복원"
                    : "보관 상태 다시 확인"}
                </button>
              )}
              {d.status !== "trashed" && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        "목록에서 숨길까요? Drive 원본은 삭제되지 않습니다.",
                      )
                    )
                      void action(base + "/" + d.id + "/archive");
                  }}
                >
                  보관함으로
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {handoff && (
        <div className="private-card">
          <h3>분석 요청문</h3>
          <p>
            요청문을 편집하고 복사한 뒤 ChatGPT에 직접 전달해 주세요. 자동
            전송되지 않습니다.
          </p>
          <textarea
            value={handoff}
            onChange={(e) => setHandoff(e.target.value)}
            rows={7}
          />
          <button
            onClick={() =>
              void navigator.clipboard
                .writeText(handoff)
                .then(() => setMessage("요청문을 복사했습니다."))
                .catch(() => setMessage("복사 권한을 확인해 주세요."))
            }
          >
            요청문 복사
          </button>
          <button className="secondary" onClick={() => setHandoff("")}>
            닫기
          </button>
        </div>
      )}
    </section>
  );
}
