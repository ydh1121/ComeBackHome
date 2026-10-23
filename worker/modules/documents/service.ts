import {
  PrivateError,
  privateJson,
  readJson,
  readBounded,
  type PrivateEnv,
  type Principal,
} from "../auth/contracts";
import { digest, encode64, randomToken } from "../auth/crypto";
import { CaseRepository } from "../injury/repository";
import {
  DriveArchive,
  refreshDriveToken,
  seal,
  unseal,
  validFilePrefix,
  type DriveConnection,
} from "./drive";
const MAX_BYTES = 20 * 1024 * 1024,
  CHUNK_BYTES = 1024 * 1024;
const now = () => new Date().toISOString();
interface DocumentRow {
  id: string;
  case_id: string;
  filename: string;
  mime: string;
  bytes: number;
  sha256: string;
  drive_file_id: string | null;
  folder_id: string | null;
  status: string;
  session_encrypted: string | null;
}
function configured(env: PrivateEnv) {
  return !!(
    env.PRIVATE_DRIVE_CLIENT_ID &&
    env.PRIVATE_DRIVE_CLIENT_SECRET &&
    env.PRIVATE_DRIVE_TOKEN_KEY &&
    env.PRIVATE_DRIVE_PICKER_KEY &&
    env.PRIVATE_DRIVE_APP_ID
  );
}
function callback(request: Request) {
  return new URL("/api/private/case/documents/oauth/callback", request.url)
    .href;
}
export async function handleDocuments(
  request: Request,
  env: PrivateEnv,
  p: Principal,
  repo: CaseRepository,
  owner: boolean,
  path: string[],
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  await repo.authorize();
  const connection = () =>
    env.DB.prepare(
      `SELECT * FROM case_drive_connections WHERE case_id=?1 AND ${repo.acl()}`,
    )
      .bind(...repo.args())
      .first<DriveConnection>();
  const drive = async () => {
    const c = await connection();
    if (!c || !c.folder_id)
      throw new PrivateError(409, "DRIVE_FOLDER_REQUIRED");
    return {
      c,
      api: new DriveArchive(await refreshDriveToken(c, env, fetcher), fetcher),
    };
  };
  if (path[0] === "status" && request.method === "GET") {
    const c = await connection();
    return privateJson({
      configured: configured(env),
      owner,
      connected: !!c,
      folderSelected: !!c?.folder_id,
      maxBytes: MAX_BYTES,
      chunkBytes: CHUNK_BYTES,
    });
  }
  if (path[0] === "oauth") {
    if (!owner) throw new PrivateError(403, "OWNER_ONLY");
    if (!configured(env)) throw new PrivateError(503, "DRIVE_NOT_CONFIGURED");
    if (path[1] === "start" && request.method === "POST") {
      const state = randomToken(),
        verifier = randomToken();
      const challenge = encode64(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(verifier),
          ),
        ),
      )
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "");
      await env.DB.prepare(
        "DELETE FROM case_oauth_states WHERE user_id=?1 OR expires_at<?2",
      )
        .bind(p.id, now())
        .run();
      await env.DB.prepare(
        "INSERT INTO case_oauth_states VALUES (?1,?2,?3,?4,?5)",
      )
        .bind(
          await digest(state),
          p.id,
          p.sessionHash,
          await seal(verifier, env),
          new Date(Date.now() + 600000).toISOString(),
        )
        .run();
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: env.PRIVATE_DRIVE_CLIENT_ID!,
        redirect_uri: callback(request),
        response_type: "code",
        scope: "openid https://www.googleapis.com/auth/drive.file",
        access_type: "offline",
        prompt: "consent",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString();
      return privateJson({ url: url.href });
    }
    if (path[1] === "callback" && request.method === "GET") {
      const query = new URL(request.url).searchParams,
        state = query.get("state") ?? "";
      const row = await env.DB.prepare(
        "DELETE FROM case_oauth_states WHERE state_hash=?1 AND user_id=?2 AND session_hash=?3 AND expires_at>?4 RETURNING verifier_encrypted",
      )
        .bind(await digest(state), p.id, p.sessionHash, now())
        .first<{ verifier_encrypted: string }>();
      if (!row) throw new PrivateError(400, "OAUTH_STATE_EXPIRED");
      if (query.has("error"))
        return new Response(null, {
          status: 303,
          headers: {
            Location: "/injury?section=documents&drive=cancelled",
            "Cache-Control": "no-store",
          },
        });
      const code = query.get("code");
      if (!code || code.length > 4096)
        throw new PrivateError(400, "OAUTH_CODE_REQUIRED");
      const response = await fetcher("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.PRIVATE_DRIVE_CLIENT_ID!,
          client_secret: env.PRIVATE_DRIVE_CLIENT_SECRET!,
          code,
          code_verifier: await unseal(row.verifier_encrypted, env),
          redirect_uri: callback(request),
          grant_type: "authorization_code",
        }),
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      });
      const tokens = (await response.json()) as {
        access_token?: string;
        refresh_token?: string;
      };
      if (!response.ok || !tokens.access_token || !tokens.refresh_token)
        throw new PrivateError(502, "DRIVE_CONNECT_FAILED");
      const identity = await fetcher(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          headers: { Authorization: "Bearer " + tokens.access_token },
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        },
      );
      const user = (await identity.json()) as { sub?: string };
      if (!identity.ok || !user.sub)
        throw new PrivateError(502, "DRIVE_CONNECT_FAILED");
      const old = await connection();
      if (old && old.google_subject !== user.sub)
        throw new PrivateError(409, "DRIVE_ACCOUNT_CHANGED");
      await repo.authorize();
      await env.DB.prepare(
        `INSERT INTO case_drive_connections SELECT ?1,?5,?6,'','[]',?2,?7 WHERE ${repo.acl()} ON CONFLICT(case_id) DO UPDATE SET refresh_token_encrypted=excluded.refresh_token_encrypted,connected_at=excluded.connected_at`,
      )
        .bind(
          ...repo.args(),
          await seal(tokens.refresh_token, env),
          user.sub,
          now(),
        )
        .run();
      await repo.audit("drive-connect", null);
      return new Response(null, {
        status: 303,
        headers: {
          Location: "/injury?section=documents&drive=connected",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
  }
  if (path[0] === "picker" && request.method === "POST") {
    if (!owner) throw new PrivateError(403, "OWNER_ONLY");
    const c = await connection();
    if (!c) throw new PrivateError(409, "DRIVE_CONNECT_REQUIRED");
    return privateJson({
      accessToken: await refreshDriveToken(c, env, fetcher),
      appId: env.PRIVATE_DRIVE_APP_ID,
      apiKey: env.PRIVATE_DRIVE_PICKER_KEY,
    });
  }
  if (path[0] === "folder" && request.method === "PUT") {
    if (!owner) throw new PrivateError(403, "OWNER_ONLY");
    const body = await readJson(request);
    if (
      typeof body.folderId !== "string" ||
      !/^[A-Za-z0-9_-]{10,150}$/.test(body.folderId)
    )
      throw new PrivateError(400, "INVALID_FOLDER");
    const c = await connection();
    if (!c) throw new PrivateError(409, "DRIVE_CONNECT_REQUIRED");
    if (c.folder_id && c.folder_id !== body.folderId)
      throw new PrivateError(409, "ARCHIVE_FOLDER_LOCKED");
    const api = new DriveArchive(
        await refreshDriveToken(c, env, fetcher),
        fetcher,
      ),
      permissions = await api.privateFolder(body.folderId);
    await env.DB.prepare(
      `UPDATE case_drive_connections SET folder_id=?5,permission_ids_json=?6 WHERE case_id=?1 AND ${repo.acl()}`,
    )
      .bind(...repo.args(), body.folderId, JSON.stringify(permissions))
      .run();
    await repo.audit("drive-folder", body.folderId);
    return privateJson({ ok: true });
  }
  if (!path.length && request.method === "POST") {
    const b = await readJson(request);
    if (
      typeof b.filename !== "string" ||
      !b.filename.trim() ||
      b.filename.length > 160 ||
      /[\x00-\x1f/\\]/.test(b.filename) ||
      !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(
        String(b.mime),
      ) ||
      typeof b.bytes !== "number" ||
      !Number.isSafeInteger(b.bytes) ||
      b.bytes < 12 ||
      b.bytes > MAX_BYTES ||
      typeof b.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(b.sha256)
    )
      throw new PrivateError(400, "INVALID_FILE");
    const existing = await env.DB.prepare(
      `SELECT id,status FROM case_documents WHERE case_id=?1 AND sha256=?5 AND bytes=?6 AND ${repo.acl()}`,
    )
      .bind(...repo.args(), b.sha256, b.bytes)
      .first();
    if (existing) return privateJson({ ...existing, duplicate: true });
    const { c, api } = await drive();
    await api.privateFolder(c.folder_id);
    const id = crypto.randomUUID(),
      driveId = await api.generateId();
    const row = await env.DB.prepare(
      `INSERT INTO case_documents SELECT ?5,?1,?6,?7,?8,?9,?10,NULL,?11,'pending',NULL,?2,?12,?12 WHERE ${repo.acl()} ON CONFLICT(case_id,sha256,bytes) DO NOTHING RETURNING id,status`,
    )
      .bind(
        ...repo.args(),
        id,
        b.filename,
        String(b.mime),
        b.bytes,
        b.sha256,
        driveId,
        c.folder_id,
        now(),
      )
      .first();
    if (!row) throw new PrivateError(409, "UPLOAD_RETRY");
    await repo.audit("document-reserve", id);
    return privateJson(row, 201);
  }
  const id = path[0];
  if (!id || !/^[A-Za-z0-9-]{8,80}$/.test(id))
    throw new PrivateError(404, "DOCUMENT_NOT_FOUND");
  const row = await env.DB.prepare(
    `SELECT * FROM case_documents WHERE case_id=?1 AND id=?5 AND ${repo.acl()}`,
  )
    .bind(...repo.args(), id)
    .first<DocumentRow>();
  if (!row) throw new PrivateError(404, "DOCUMENT_NOT_FOUND");
  if (path[1] === "archive" && request.method === "POST") {
    // Only metadata is hidden. Immutable original is retained in Drive.
    await env.DB.prepare(
      `UPDATE case_documents SET status='trashed',updated_at=?6 WHERE case_id=?1 AND id=?5 AND ${repo.acl()}`,
    )
      .bind(...repo.args(), id, now())
      .run();
    await repo.audit("document-hide", id);
    return privateJson({ ok: true, originalPreserved: true });
  }
  if (path[1] === "restore" && request.method === "POST") {
    if (row.status !== "trashed")
      throw new PrivateError(409, "INVALID_DOCUMENT_STATE");
    await env.DB.prepare(
      `UPDATE case_documents SET status='verifying',updated_at=?6 WHERE case_id=?1 AND id=?5 AND ${repo.acl()}`,
    )
      .bind(...repo.args(), id, now())
      .run();
    row.status = "verifying";
  } else if (row.status === "trashed")
    throw new PrivateError(409, "DOCUMENT_HIDDEN");
  const { c, api } = await drive();
  const verify = () =>
    api.verify({
      id: row.drive_file_id!,
      bytes: row.bytes,
      sha256: row.sha256,
      mime: row.mime,
      folder: row.folder_id!,
      allowedPermissionIds: JSON.parse(c.permission_ids_json),
    });
  if (path[1] === "upload" && request.method === "POST") {
    if (row.status === "ready")
      return privateJson({ offset: row.bytes, complete: true });
    if (!row.drive_file_id)
      throw new PrivateError(409, "INVALID_DOCUMENT_STATE");
    let session = row.session_encrypted
      ? await unseal(row.session_encrypted, env)
      : null;
    if (!session) {
      session = await api.begin({
        id: row.drive_file_id,
        name: row.filename,
        mime: row.mime,
        bytes: row.bytes,
        folder: row.folder_id!,
      });
      const saved = await env.DB.prepare(
        `UPDATE case_documents SET session_encrypted=?6,status='uploading',updated_at=?7 WHERE case_id=?1 AND id=?5 AND session_encrypted IS NULL AND ${repo.acl()} RETURNING id`,
      )
        .bind(...repo.args(), id, await seal(session, env), now())
        .first();
      if (!saved) throw new PrivateError(409, "UPLOAD_RETRY");
    }
    return privateJson(await api.offset(session, row.bytes));
  }
  if (path[1] === "upload" && request.method === "PUT") {
    if (!row.session_encrypted || row.status === "ready")
      throw new PrivateError(409, "INVALID_DOCUMENT_STATE");
    const offset = Number(new URL(request.url).searchParams.get("offset")),
      bytes = await readBounded(request, CHUNK_BYTES);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset % 262144 !== 0 ||
      !bytes.byteLength ||
      offset + bytes.byteLength > row.bytes ||
      (offset + bytes.byteLength < row.bytes && bytes.byteLength % 262144 !== 0)
    )
      throw new PrivateError(400, "INVALID_CHUNK");
    if (offset === 0 && !validFilePrefix(bytes, row.mime))
      throw new PrivateError(400, "FILE_TYPE_MISMATCH");
    return privateJson(
      await api.chunk(
        await unseal(row.session_encrypted, env),
        bytes,
        offset,
        row.bytes,
        row.mime,
      ),
    );
  }
  if (
    (path[1] === "verify" || path[1] === "restore") &&
    request.method === "POST"
  ) {
    try {
      const m = await verify();
      const saved = await env.DB.prepare(
        `UPDATE case_documents SET status='ready',drive_revision=?6,session_encrypted=NULL,updated_at=?7 WHERE case_id=?1 AND id=?5 AND status<>'trashed' AND ${repo.acl()} RETURNING id`,
      )
        .bind(...repo.args(), id, m.headRevisionId ?? null, now())
        .first();
      if (!saved) throw new PrivateError(403, "CASE_ACCESS_DENIED");
      await repo.audit("document-verified", id);
      return privateJson({ id, status: "ready" });
    } catch (error) {
      await env.DB.prepare(
        `UPDATE case_documents SET status='failed',updated_at=?6 WHERE case_id=?1 AND id=?5 AND ${repo.acl()}`,
      )
        .bind(...repo.args(), id, now())
        .run();
      throw error;
    }
  }
  if (path[1] === "download" && request.method === "GET") {
    if (row.status !== "ready")
      throw new PrivateError(409, "DOCUMENT_NOT_VERIFIED");
    await verify();
    await repo.authorize();
    const response = await api.download(row.drive_file_id!);
    await repo.audit("document-download", id);
    return new Response(response.body, {
      headers: {
        "Content-Type": row.mime,
        "Content-Disposition": `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
      },
    });
  }
  if (path[1] === "handoff" && request.method === "GET") {
    if (row.status !== "ready")
      throw new PrivateError(409, "DOCUMENT_NOT_VERIFIED");
    await verify();
    await repo.authorize();
    await repo.audit("document-handoff", id);
    return privateJson({
      url: `https://drive.google.com/file/d/${encodeURIComponent(row.drive_file_id!)}/view`,
      sha256: row.sha256,
    });
  }
  throw new PrivateError(404, "NOT_FOUND");
}
