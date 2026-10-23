import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiError, privateRequest } from "./client";
import { invalidateLocalReads } from "../../pwa/localCache";
import { releasePrivateImportImage } from "../../application/services/WorkbookImportFileSelectionAction";
import "./auth.css";
export interface User {
  id: string;
  loginId: string;
  role: "admin" | "member";
  mustChangePassword: boolean;
}
interface Session {
  enabled: boolean;
  user: User | null;
  legacyAccess?: "read" | "write" | null;
}
interface AuthState extends Session {
  refresh: () => Promise<void>;
  logout: (all?: boolean) => Promise<void>;
}
const AuthContext = createContext<AuthState>({
  enabled: false,
  user: null,
  refresh: async () => {},
  logout: async () => {},
});
export const useAuth = () => useContext(AuthContext);
function clearPersonalMemory() {
  invalidateLocalReads();
  releasePrivateImportImage();
  for (const key of ["cbh:import-batches:v1", "cbh:import-batches:v2"])
    localStorage.removeItem(key);
}
export function AuthRoot({
  children,
  mock = false,
}: {
  children: ReactNode;
  mock?: boolean;
}) {
  const [session, setSession] = useState<Session | null>(
      mock ? { enabled: false, user: null } : null,
    ),
    [error, setError] = useState(""),
    [checking, setChecking] = useState(!mock);
  const current = useRef<Session | null>(session),
    generation = useRef(0),
    pendingLogout = useRef<boolean | null>(null),
    sessionRequest = useRef<AbortController | null>(null);
  const apply = useCallback((next: Session) => {
    if (
      current.current?.user?.id !== next.user?.id ||
      current.current?.enabled !== next.enabled
    )
      clearPersonalMemory();
    current.current = next;
    setSession(next);
  }, []);
  const refresh = useCallback(async () => {
    if (mock || pendingLogout.current !== null) return;
    const version = ++generation.current;
    sessionRequest.current?.abort();
    const abort = new AbortController();
    sessionRequest.current = abort;
    try {
      const next = await privateRequest<Session>(
        "auth/session",
        "GET",
        undefined,
        abort.signal,
      );
      if (version !== generation.current || abort.signal.aborted) return;
      apply(next);
      setError("");
      setChecking(false);
    } catch {
      if (version !== generation.current || abort.signal.aborted) return;
      setError(
        "로그인 상태를 확인하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.",
      );
      setChecking(true);
    }
  }, [apply, mock]);
  const broadcast = () => {
    localStorage.setItem("cbh.auth-event", crypto.randomUUID());
  };
  const logout = useCallback(
    async (all = false) => {
      pendingLogout.current = all;
      generation.current++;
      setChecking(true);
      clearPersonalMemory();
      apply({ enabled: true, user: null });
      try {
        await privateRequest(
          "auth/" + (all ? "logout-all" : "logout"),
          "POST",
          {},
        );
      } catch (error) {
        if (!(error instanceof ApiError && error.code === "LOGIN_REQUIRED")) {
          setError(
            "서버에서 로그아웃을 확인하지 못했습니다. 연결 후 로그아웃을 다시 시도해 주세요.",
          );
          return;
        }
      }
      pendingLogout.current = null;
      setError("");
      setChecking(false);
      broadcast();
    },
    [apply],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (mock || !session?.enabled) return;
    const lock = () => {
      generation.current++;
      clearPersonalMemory();
      apply({ enabled: true, user: null });
    };
    const verify = () => {
      setChecking(true);
      void refresh();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === "cbh.auth-event") verify();
    };
    const hide = () => {
      generation.current++;
      sessionRequest.current?.abort();
      setChecking(true);
    };
    const visibility = () => {
      if (document.visibilityState === "visible") verify();
      else hide();
    };
    const originalFetch = window.fetch;
    const guardedFetch: typeof fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (response.headers.get("X-CBH-Session") === "invalid")
        window.dispatchEvent(new Event("cbh-auth-expired"));
      return response;
    };
    window.fetch = guardedFetch;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60000);
    window.addEventListener("cbh-auth-expired", lock);
    window.addEventListener("storage", storage);
    window.addEventListener("pageshow", verify);
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearInterval(timer);
      if (window.fetch === guardedFetch) window.fetch = originalFetch;
      window.removeEventListener("cbh-auth-expired", lock);
      window.removeEventListener("storage", storage);
      window.removeEventListener("pageshow", verify);
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [session?.enabled, mock, apply, refresh]);
  const value: AuthState = {
    ...(session ?? { enabled: true, user: null }),
    refresh,
    logout,
  };
  let content: ReactNode;
  if (!session) content = null;
  else if (!session.enabled) content = children;
  else if (!session.user)
    content = (
      <Login
        onSuccess={async () => {
          broadcast();
          await refresh();
        }}
      />
    );
  else if (session.user.mustChangePassword)
    content = <PasswordChange initial />;
  else content = children;
  return (
    <AuthContext.Provider value={value}>
      <div hidden={checking}>{content}</div>
      {checking && (
        <main className="auth-card" role="status">
          <h1>ComeBackHome</h1>
          <p>{error || "로그인 상태 확인 중…"}</p>
          {error && (
            <button
              onClick={() =>
                pendingLogout.current !== null
                  ? void logout(pendingLogout.current)
                  : void refresh()
              }
            >
              {pendingLogout.current !== null
                ? "로그아웃 다시 시도"
                : "다시 확인"}
            </button>
          )}
        </main>
      )}
    </AuthContext.Provider>
  );
}
function Login({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <main className="auth-card">
      <h1>ComeBackHome</h1>
      <p>내 계정으로 로그인</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            await privateRequest("auth/login", "POST", {
              loginId: data.get("login"),
              password: data.get("password"),
              remember: data.get("remember") === "on",
              deviceName: data.get("device"),
            });
            e.currentTarget?.reset();
            await onSuccess();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          아이디
          <input
            name="login"
            autoComplete="username"
            autoCapitalize="none"
            required
          />
        </label>
        <label>
          비밀번호
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </label>
        <label>
          기기 이름
          <input
            name="device"
            defaultValue={
              /iPhone/.test(navigator.userAgent) ? "내 iPhone" : "내 PC"
            }
            maxLength={80}
          />
        </label>
        <label className="auth-check">
          <input name="remember" type="checkbox" />이 기기에서 로그인 유지
        </label>
        <button disabled={busy}>{busy ? "확인 중…" : "로그인"}</button>
        <p role="alert">{error}</p>
      </form>
    </main>
  );
}
export function PasswordChange({ initial = false }: { initial?: boolean }) {
  const auth = useAuth(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="auth-card">
      <h1>{initial ? "임시 비밀번호 변경" : "비밀번호 변경"}</h1>
      <p>
        15~128자로 설정해 주세요. 변경하면 모든 기기에서 다시 로그인해야 합니다.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = e.currentTarget,
            d = new FormData(f);
          if (d.get("next") !== d.get("repeat")) {
            setError("새 비밀번호가 서로 다릅니다.");
            return;
          }
          setBusy(true);
          try {
            await privateRequest("auth/password", "POST", {
              currentPassword: d.get("current"),
              newPassword: d.get("next"),
            });
            f.reset();
            clearPersonalMemory();
            localStorage.setItem("cbh.auth-event", crypto.randomUUID());
            await auth.refresh();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          현재 비밀번호
          <input
            name="current"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <label>
          새 비밀번호
          <input
            name="next"
            type="password"
            autoComplete="new-password"
            minLength={15}
            maxLength={128}
            required
          />
        </label>
        <label>
          새 비밀번호 다시 입력
          <input
            name="repeat"
            type="password"
            autoComplete="new-password"
            minLength={15}
            maxLength={128}
            required
          />
        </label>
        <button disabled={busy}>변경 후 다시 로그인</button>
        <p role="alert">{error}</p>
      </form>
      {initial && (
        <button className="secondary" onClick={() => void auth.logout()}>
          로그아웃
        </button>
      )}
    </section>
  );
}
export function AccountPage() {
  const auth = useAuth(),
    [visible, setVisible] = useState(true),
    [devices, setDevices] = useState<
      Array<{
        device_name: string;
        current: boolean;
        last_seen_at: string;
        expires_at: string;
      }>
    >([]),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      privateRequest<{ shortcutVisible: boolean }>(
        "auth/preferences",
        "GET",
        undefined,
        controller.signal,
      ),
      privateRequest<{ devices: typeof devices }>(
        "auth/devices",
        "GET",
        undefined,
        controller.signal,
      ),
    ])
      .then(([p, d]) => {
        setVisible(p.shortcutVisible);
        setDevices(d.devices);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  return (
    <main className="private-page">
      <header className="private-header">
        <a href="/">ComeBackHome</a>
        <a href="/injury">산재</a>
      </header>
      <h1>내 계정</h1>
      <p>{auth.user?.loginId}</p>
      <section className="private-card">
        <label className="auth-check">
          <input
            type="checkbox"
            checked={visible}
            onChange={async (e) => {
              const value = e.target.checked;
              try {
                await privateRequest("auth/preferences", "PUT", {
                  shortcutVisible: value,
                });
                setVisible(value);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          />
          산재 바로가기 표시
        </label>
        <p role="alert">{error}</p>
      </section>
      <section className="private-card">
        <h2>로그인한 기기</h2>
        {devices.map((d, i) => (
          <p key={i}>
            <b>
              {d.device_name}
              {d.current ? " · 현재 기기" : ""}
            </b>
            <br />
            마지막 사용{" "}
            {new Date(d.last_seen_at).toLocaleString("ko-KR", {
              timeZone: "Asia/Seoul",
            })}
          </p>
        ))}
        <div className="private-actions">
          <button onClick={() => void auth.logout()}>현재 기기 로그아웃</button>
          <button
            className="secondary"
            onClick={() => {
              if (confirm("모든 기기에서 로그아웃할까요?"))
                void auth.logout(true);
            }}
          >
            전체 기기 로그아웃
          </button>
        </div>
      </section>
      <PasswordChange />
    </main>
  );
}
export function InjuryShortcut() {
  const auth = useAuth(),
    [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!auth.enabled || !auth.user || auth.user.mustChangePassword) return;
    let active = true;
    privateRequest<{ shortcutVisible: boolean }>("auth/preferences")
      .then((v) => {
        if (active) setVisible(v.shortcutVisible);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [auth.enabled, auth.user?.id]);
  return visible ? (
    <a className="injury-shortcut" href="/injury" aria-label="산재 관리 열기">
      산재
    </a>
  ) : null;
}
