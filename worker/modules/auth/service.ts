import type { D1DatabaseLike } from "../../../packages/portable/d1/types";
import { authReadiness } from "./readiness";
import {
  digest,
  randomToken,
  type PasswordHash,
} from "./crypto";
import { PASSWORD_ITERATIONS, PASSWORD_PROTOCOL } from "../../../src/modules/auth/password-policy";
import { material64, passwordRecord, passwordVerifier, verifyPasswordMaterial, wrapLegacyPassword } from "./password-verifier";
import {
  PrivateError,
  privateJson,
  readJson,
  type Principal,
  type PrivateEnv,
} from "./contracts";

const COOKIE = "__Host-cbh-session";
const now = () => new Date().toISOString();
export async function authAudit(
  db: D1DatabaseLike,
  actor: string | null,
  action: string,
  outcome: string,
  target: string | null = null,
): Promise<void> {
  await db
    .prepare("INSERT INTO auth_audit VALUES (?1,?2,?3,?4,?5,?6)")
    .bind(crypto.randomUUID(), actor, action, outcome, target, now())
    .run();
}
function cookie(token: string, seconds?: number): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax${seconds === undefined ? "" : `; Max-Age=${seconds}`}`;
}
function sessionToken(request: Request): string | null {
  const found = (request.headers.get("Cookie") ?? "")
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.startsWith(COOKIE + "="));
  if (found.length !== 1) return null;
  const value = found[0].slice(COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
interface UserRow {
  id: string;
  login_id: string;
  role: "admin" | "member";
  disabled: number;
  must_change_password: number;
  auth_epoch: number;
}
interface SessionRow extends UserRow {
  token_hash: string;
  expires_at: string;
  last_seen_at: string;
  idle_hours: number;
}
export async function authenticate(
  request: Request,
  env: PrivateEnv,
  allowPasswordChange = false,
): Promise<Principal> {
  const token = sessionToken(request);
  if (!token) throw new PrivateError(401, "LOGIN_REQUIRED");
  const tokenHash = await digest(token),
    instant = now();
  const row = await env.DB.prepare(
    `SELECT u.*,s.token_hash,s.expires_at,s.last_seen_at,p.idle_hours FROM auth_sessions s
    JOIN auth_users u ON u.id=s.user_id AND u.auth_epoch=s.auth_epoch CROSS JOIN auth_policy p
    WHERE s.token_hash=?1 AND s.revoked_at IS NULL AND s.expires_at>?2 AND u.disabled=0 AND p.id='default'`,
  )
    .bind(tokenHash, instant)
    .first<SessionRow>();
  if (
    !row ||
    Date.now() - Date.parse(row.last_seen_at) > row.idle_hours * 3600000
  )
    throw new PrivateError(401, "LOGIN_REQUIRED");
  if (row.must_change_password && !allowPasswordChange)
    throw new PrivateError(403, "PASSWORD_CHANGE_REQUIRED");
  if (Date.now() - Date.parse(row.last_seen_at) > 5 * 60000)
    await env.DB.prepare(
      "UPDATE auth_sessions SET last_seen_at=?2 WHERE token_hash=?1 AND revoked_at IS NULL",
    )
      .bind(tokenHash, instant)
      .run();
  return {
    id: row.id,
    loginId: row.login_id,
    role: row.role,
    mustChangePassword: !!row.must_change_password,
    sessionHash: tokenHash,
    authEpoch: row.auth_epoch,
  };
}
async function throttle(
  db: D1DatabaseLike,
  keys: string[],
  limit: number,
): Promise<void> {
  const window = Math.floor(Date.now() / 900000);
  const hashes = await Promise.all(keys.map(digest));
  for (const key of hashes) {
    const row = await db
      .prepare(
        `INSERT INTO auth_rate_limits VALUES (?1,?2,1) ON CONFLICT(key_hash) DO UPDATE SET
      attempts=CASE WHEN window_start=?2 THEN attempts+1 ELSE 1 END,window_start=?2 RETURNING attempts`,
      )
      .bind(key, window)
      .first<{ attempts: number }>();
    if (!row || row.attempts > limit) throw new PrivateError(429, "TRY_LATER");
  }
}
async function credentials(
  db: D1DatabaseLike,
  id: string,
): Promise<PasswordHash | null> {
  return db
    .prepare(
      "SELECT algorithm,iterations,salt_b64,hash_b64 FROM auth_credentials WHERE user_id=?1",
    )
    .bind(id)
    .first<PasswordHash>();
}
const DUMMY: PasswordHash = {
  algorithm: "pbkdf2-sha256",
  iterations: 600000,
  salt_b64: "AAAAAAAAAAAAAAAAAAAAAA==",
  hash_b64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
};
const DUMMY_VERIFIER: PasswordHash = { ...DUMMY,
  hash_b64: "Q0JIU1IwMQAAAAAAAAAAAAAAAAAAAAAANRTSCydUQFQOCwrt36femNdwysi4FLi0z8+vBM9KBQ4=" };
function loginId(body: Record<string, unknown>) {
  return typeof body.loginId === "string" ? body.loginId.trim().toLowerCase().slice(0, 80) : "";
}
function parameters(stored: PasswordHash) {
  return { protocol: PASSWORD_PROTOCOL, iterations: PASSWORD_ITERATIONS, salt: stored.salt_b64 };
}
// A preparation request never authenticates. Upgrade only the representation,
// preserving the existing password, salt, user ID, forced change and all grants.
// CAS and audit are one transaction. A concurrent password change always wins.
async function prepareCredential(db: D1DatabaseLike, user: UserRow, stored: PasswordHash) {
  if (passwordRecord(stored).version === 2) return stored;
  const wrapped = await wrapLegacyPassword(stored), instant = now();
  await db.batch([
    db.prepare(`UPDATE auth_credentials SET hash_b64=?2,updated_at=?3
      WHERE user_id=?1 AND hash_b64=?4 AND salt_b64=?5 AND algorithm='pbkdf2-sha256' AND iterations=600000
      AND EXISTS(SELECT 1 FROM auth_users WHERE id=?1 AND auth_epoch=?6 AND disabled=0)`)
      .bind(user.id, wrapped.hash_b64, instant, stored.hash_b64, stored.salt_b64, user.auth_epoch),
    db.prepare(`INSERT INTO auth_audit SELECT ?1,NULL,'credential-format-upgrade','allowed',?2,?3
      WHERE EXISTS(SELECT 1 FROM auth_credentials WHERE user_id=?2 AND hash_b64=?4)`)
      .bind(crypto.randomUUID(), user.id, instant, wrapped.hash_b64),
  ]);
  const current = await credentials(db, user.id);
  if (!current || passwordRecord(current).version !== 2)
    throw new PrivateError(409, "SESSION_CHANGED");
  return current;
}
function publicPrincipal(p: Principal) {
  return {
    id: p.id,
    loginId: p.loginId,
    role: p.role,
    mustChangePassword: p.mustChangePassword,
  };
}

export async function handleAuth(
  request: Request,
  env: PrivateEnv,
  path: string,
): Promise<Response> {
  const db = env.DB;
  if (path === "readiness" && request.method === "GET")
    return authReadiness(db);
  if (path === "session" && request.method === "GET") {
    try {
      const p = await authenticate(request, env, true);
      const grant = await db
        .prepare(
          "SELECT permission FROM auth_workspace_grants WHERE user_id=?1 AND workspace='legacy'",
        )
        .bind(p.id)
        .first<{ permission: string }>();
      return privateJson({
        enabled: true,
        user: publicPrincipal(p),
        legacyAccess: grant?.permission ?? null,
      });
    } catch (e) {
      if (e instanceof PrivateError && e.status === 401)
        return privateJson({ enabled: true, user: null });
      throw e;
    }
  }
  if (path === "login-parameters" && request.method === "POST") {
    const login = loginId(await readJson(request));
    await throttle(db, ["prepare-ip:" + (request.headers.get("CF-Connecting-IP") ?? "local"), "prepare-login:" + login], 10);
    const user = await db.prepare("SELECT * FROM auth_users WHERE login_id=?1").bind(login).first<UserRow>();
    const stored = user && !user.disabled ? await credentials(db, user.id) : null;
    // Fixed allowed login names are already public; never expose account IDs,
    // roles, credential hashes or whether a session may be issued here.
    return privateJson(parameters(user && stored ? await prepareCredential(db, user, stored) : DUMMY));
  }
  if (path === "login" && request.method === "POST") {
    const body = await readJson(request);
    if (body.protocol !== PASSWORD_PROTOCOL) throw new PrivateError(426, "CLIENT_UPDATE_REQUIRED");
    const login = loginId(body);
    await throttle(
      db,
      [
        "ip:" + (request.headers.get("CF-Connecting-IP") ?? "local"),
        "login:" + login,
      ],
      10,
    );
    const user = await db
      .prepare("SELECT * FROM auth_users WHERE login_id=?1")
      .bind(login)
      .first<UserRow>();
    const stored = user && !user.disabled ? await credentials(db, user.id) : null;
    const verifier = stored ?? DUMMY_VERIFIER;
    const matches = await verifyPasswordMaterial(body.material, verifier);
    if (!matches || !user || !stored || user.disabled || body.salt !== stored.salt_b64) {
      await authAudit(db, null, "login", "denied");
      throw new PrivateError(401, "LOGIN_FAILED");
    }
    const policy = await db
      .prepare("SELECT * FROM auth_policy WHERE id='default'")
      .first<{ session_hours: number; remembered_days: number }>();
    if (!policy) throw new PrivateError(503, "AUTH_NOT_READY");
    const remember = body.remember === true;
    const seconds =
      (remember ? policy.remembered_days * 24 : policy.session_hours) * 3600;
    const token = randomToken(),
      issued = now(),
      hash = await digest(token);
    const device =
      typeof body.deviceName === "string"
        ? body.deviceName.trim().slice(0, 80)
        : "기기";
    // Epoch predicate prevents a login finishing after a concurrent password change/revocation.
    const inserted = await db
      .prepare(
        `INSERT INTO auth_sessions SELECT ?1,id,auth_epoch,?2,?3,?4,?4,?5,NULL FROM auth_users
      WHERE id=?6 AND auth_epoch=?7 AND disabled=0 RETURNING token_hash`,
      )
      .bind(
        hash,
        device,
        remember ? 1 : 0,
        issued,
        new Date(Date.now() + seconds * 1000).toISOString(),
        user.id,
        user.auth_epoch,
      )
      .first();
    if (!inserted) throw new PrivateError(401, "LOGIN_FAILED");
    await authAudit(db, user.id, "login", "allowed");
    return privateJson(
      {
        user: {
          id: user.id,
          loginId: user.login_id,
          role: user.role,
          mustChangePassword: !!user.must_change_password,
        },
      },
      200,
      { "Set-Cookie": cookie(token, remember ? seconds : undefined) },
    );
  }
  const principal = await authenticate(request, env, true);
  if (path === "password-parameters" && request.method === "GET") {
    const stored = await credentials(db, principal.id);
    if (!stored) throw new PrivateError(503, "AUTH_NOT_READY");
    if (passwordRecord(stored).version !== 2) throw new PrivateError(503, "AUTH_PASSWORD_UPGRADE_REQUIRED");
    return privateJson(parameters(stored));
  }
  if (path === "logout" && request.method === "POST") {
    await db
      .prepare("UPDATE auth_sessions SET revoked_at=?2 WHERE token_hash=?1")
      .bind(principal.sessionHash, now())
      .run();
    await authAudit(db, principal.id, "logout", "allowed");
    return privateJson({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
  }
  if (path === "logout-all" && request.method === "POST") {
    await db.batch([
      db
        .prepare("UPDATE auth_users SET auth_epoch=auth_epoch+1 WHERE id=?1")
        .bind(principal.id),
      db
        .prepare(
          "UPDATE auth_sessions SET revoked_at=?2 WHERE user_id=?1 AND revoked_at IS NULL",
        )
        .bind(principal.id, now()),
    ]);
    await authAudit(db, principal.id, "logout-all", "allowed");
    return privateJson({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
  }
  if (path === "password" && request.method === "POST") {
    const body = await readJson(request);
    await throttle(db, ["password:" + principal.id], 8);
    if (body.protocol !== PASSWORD_PROTOCOL) throw new PrivateError(426, "CLIENT_UPDATE_REQUIRED");
    const next = material64(body.newMaterial, 32), nextSalt = material64(body.newSalt, 16);
    if (!next || !nextSalt || body.newSalt === body.salt || body.newMaterial === body.currentMaterial)
      throw new PrivateError(400, "PASSWORD_INVALID");
    const stored = await credentials(db, principal.id);
    if (!stored || !(await verifyPasswordMaterial(body.currentMaterial, stored)) || body.salt !== stored.salt_b64)
      throw new PrivateError(401, "PASSWORD_INCORRECT");
    const hash = await passwordVerifier(next, nextSalt);
    const instant = now();
    const changed = await db.batch([
      db
        .prepare(
          `UPDATE auth_credentials SET algorithm=?2,iterations=?3,salt_b64=?4,hash_b64=?5,updated_at=?6
        WHERE user_id=?1 AND hash_b64=?7 AND EXISTS(SELECT 1 FROM auth_users WHERE id=?1 AND auth_epoch=?8) RETURNING user_id`,
        )
        .bind(
          principal.id,
          hash.algorithm,
          hash.iterations,
          hash.salt_b64,
          hash.hash_b64,
          instant,
          stored.hash_b64,
          principal.authEpoch,
        ),
      db
        .prepare(
          `UPDATE auth_users SET must_change_password=0,auth_epoch=auth_epoch+1 WHERE id=?1 AND EXISTS(SELECT 1 FROM auth_credentials WHERE user_id=?1 AND hash_b64=?2)`,
        )
        .bind(principal.id, hash.hash_b64),
      db
        .prepare(
          "UPDATE auth_sessions SET revoked_at=?2 WHERE user_id=?1 AND auth_epoch<(SELECT auth_epoch FROM auth_users WHERE id=?1)",
        )
        .bind(principal.id, instant),
    ]);
    if (!changed[0].results?.length)
      throw new PrivateError(409, "SESSION_CHANGED");
    await authAudit(db, principal.id, "password-change", "allowed");
    return privateJson({ ok: true, relogin: true }, 200, {
      "Set-Cookie": cookie("", 0),
    });
  }
  if (principal.mustChangePassword)
    throw new PrivateError(403, "PASSWORD_CHANGE_REQUIRED");
  if (path === "preferences") {
    if (request.method === "GET") {
      const row = await db
        .prepare(
          "SELECT shortcut_visible FROM auth_preferences WHERE user_id=?1",
        )
        .bind(principal.id)
        .first<{ shortcut_visible: number }>();
      return privateJson({ shortcutVisible: row?.shortcut_visible !== 0 });
    }
    if (request.method === "PUT") {
      const body = await readJson(request);
      if (typeof body.shortcutVisible !== "boolean")
        throw new PrivateError(400, "INVALID_INPUT");
      await db
        .prepare(
          "INSERT INTO auth_preferences VALUES (?1,?2,?3) ON CONFLICT(user_id) DO UPDATE SET shortcut_visible=excluded.shortcut_visible,updated_at=excluded.updated_at",
        )
        .bind(principal.id, body.shortcutVisible ? 1 : 0, now())
        .run();
      return privateJson({ shortcutVisible: body.shortcutVisible });
    }
  }
  if (path === "devices" && request.method === "GET") {
    const rows = await db
      .prepare(
        "SELECT token_hash,device_name,remembered,issued_at,last_seen_at,expires_at FROM auth_sessions WHERE user_id=?1 AND revoked_at IS NULL AND expires_at>?2 AND auth_epoch=?3",
      )
      .bind(principal.id, now(), principal.authEpoch)
      .all<{
        token_hash: string;
        device_name: string;
        remembered: number;
        issued_at: string;
        last_seen_at: string;
        expires_at: string;
      }>();
    return privateJson({
      devices: rows.results.map(({ token_hash, ...r }) => ({
        ...r,
        current: token_hash === principal.sessionHash,
      })),
    });
  }
  throw new PrivateError(404, "NOT_FOUND");
}
