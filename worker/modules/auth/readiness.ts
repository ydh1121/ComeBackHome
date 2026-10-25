import type { D1DatabaseLike } from "../../../packages/portable/d1/types";
import { hashPassword } from "./crypto";
import { PrivateError, privateJson } from "./contracts";

type RuntimeState = "supported" | "unsupported" | "unavailable";

// One fixed public vector per isolate, shared by concurrent requests. No user
// input, password, salt, session, private record, writes or external requests.
// This reports capability only: a pass is not a production login/CPU acceptance.
export function createPasswordRuntimeCheck() {
  let result: Promise<RuntimeState> | undefined;
  return () => (result ??= (async (): Promise<RuntimeState> => {
      try {
        const hash = await hashPassword(
          "cbh-auth-runtime-probe-v1", new Uint8Array(16),
        );
        return hash.hash_b64 === "7Z0sARnt0CSGGpJd7T9sSXSt929/3JI7fI9OEOnTSms="
          ? "supported" : "unavailable";
      } catch (error) {
        return error instanceof PrivateError && error.code === "AUTH_PASSWORD_RUNTIME_UNSUPPORTED"
          ? "unsupported" : "unavailable";
      }
    })());
}

const checkPasswordRuntime = createPasswordRuntimeCheck();

export async function authReadiness(db: D1DatabaseLike): Promise<Response> {
  let database = "unavailable";
  try {
    // Read the policy only, never account or credential data. Do not expose
    // policy values or raw D1 errors in this unauthenticated health response.
    const policy = await db.prepare(
      "SELECT session_hours,remembered_days,idle_hours FROM auth_policy WHERE id='default'",
    ).first<{ session_hours: number; remembered_days: number; idle_hours: number }>();
    if (
      policy && policy.session_hours >= 1 && policy.session_hours <= 24 &&
      policy.remembered_days >= 1 && policy.remembered_days <= 30 &&
      policy.idle_hours >= 1 && policy.idle_hours <= 720
    ) database = "ready";
  } catch { /* A fixed status is sufficient; do not expose SQL or driver text. */ }
  const passwordRuntime = await checkPasswordRuntime();
  return privateJson({
    database,
    passwordRuntime,
    ...(passwordRuntime === "unsupported" ? { error: "AUTH_PASSWORD_RUNTIME_UNSUPPORTED" }
      : passwordRuntime === "unavailable" ? { error: "AUTH_PASSWORD_RUNTIME_UNAVAILABLE" }
      : database !== "ready" ? { error: "AUTH_NOT_READY" } : {}),
  }, database === "ready" && passwordRuntime === "supported" ? 200 : 503);
}
