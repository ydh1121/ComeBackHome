import { decode64, encode64, digest } from "../auth/crypto";
import { PrivateError, readBounded, type PrivateEnv } from "../auth/contracts";
export interface DriveMetadata {
  id: string;
  name: string;
  size?: string;
  sha256Checksum?: string;
  mimeType: string;
  parents?: string[];
  trashed?: boolean;
  headRevisionId?: string;
  permissions?: Array<{ id: string; type: string; role: string }>;
}
export interface DriveConnection {
  refresh_token_encrypted: string;
  folder_id: string;
  google_subject: string;
  permission_ids_json: string;
}
export async function seal(value: string, env: PrivateEnv): Promise<string> {
  const key = await encryptionKey(env),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode("cbh-private-drive/v1"),
    },
    key,
    new TextEncoder().encode(value),
  );
  return encode64(iv) + "." + encode64(new Uint8Array(encrypted));
}
export async function unseal(value: string, env: PrivateEnv): Promise<string> {
  const [iv, data] = value.split(".");
  try {
    return new TextDecoder().decode(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: decode64(iv),
          additionalData: new TextEncoder().encode("cbh-private-drive/v1"),
        },
        await encryptionKey(env),
        decode64(data),
      ),
    );
  } catch {
    throw new PrivateError(503, "DRIVE_KEY_UNAVAILABLE");
  }
}
async function encryptionKey(env: PrivateEnv): Promise<CryptoKey> {
  if (!env.PRIVATE_DRIVE_TOKEN_KEY)
    throw new PrivateError(503, "DRIVE_NOT_CONFIGURED");
  const raw = decode64(env.PRIVATE_DRIVE_TOKEN_KEY);
  if (raw.length !== 32) throw new PrivateError(503, "DRIVE_NOT_CONFIGURED");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export class DriveArchive {
  constructor(
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.fetcher("https://www.googleapis.com/" + path, {
      ...init,
      headers: { Authorization: "Bearer " + this.token, ...init.headers },
      signal: AbortSignal.timeout(25000),
      redirect: "error",
    });
    if (!response.ok && response.status !== 308)
      throw new PrivateError(
        response.status === 401 ? 401 : response.status === 404 ? 404 : 502,
        response.status === 401
          ? "DRIVE_RECONNECT"
          : response.status === 404
            ? "DRIVE_FILE_MISSING"
            : "DRIVE_REQUEST_FAILED",
      );
    return response;
  }
  async metadata(id: string): Promise<DriveMetadata> {
    return (
      await this.request(
        `drive/v3/files/${encodeURIComponent(id)}?fields=id,name,size,sha256Checksum,mimeType,parents,trashed,headRevisionId,permissions(id,type,role)&supportsAllDrives=true`,
      )
    ).json();
  }
  async permissions(
    id: string,
  ): Promise<Array<{ id: string; type: string; role: string }>> {
    const r = (await (
      await this.request(
        `drive/v3/files/${encodeURIComponent(id)}/permissions?fields=permissions(id,type,role),nextPageToken&pageSize=100&supportsAllDrives=true`,
      )
    ).json()) as {
      permissions: Array<{ id: string; type: string; role: string }>;
      nextPageToken?: string;
    };
    if (r.nextPageToken) throw new PrivateError(403, "DRIVE_NOT_PRIVATE");
    return r.permissions;
  }
  async privateFolder(id: string): Promise<string[]> {
    const m = await this.metadata(id),
      permissions = await this.permissions(id);
    if (
      m.mimeType !== "application/vnd.google-apps.folder" ||
      m.trashed ||
      permissions.length !== 1 ||
      permissions[0].type !== "user" ||
      permissions[0].role !== "owner"
    )
      throw new PrivateError(403, "PRIVATE_FOLDER_REQUIRED");
    return permissions.map((p) => p.id);
  }
  async generateId(): Promise<string> {
    const body = (await (
      await this.request(
        "drive/v3/files/generateIds?count=1&space=drive&type=files",
      )
    ).json()) as { ids: string[] };
    if (!body.ids?.[0]) throw new PrivateError(502, "DRIVE_REQUEST_FAILED");
    return body.ids[0];
  }
  async begin(input: {
    id: string;
    name: string;
    mime: string;
    bytes: number;
    folder: string;
  }): Promise<string> {
    const response = await this.request(
      "upload/drive/v3/files?uploadType=resumable&fields=id",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Upload-Content-Type": input.mime,
          "X-Upload-Content-Length": String(input.bytes),
        },
        body: JSON.stringify({
          id: input.id,
          name: input.name,
          mimeType: input.mime,
          parents: [input.folder],
        }),
      },
    );
    const location = response.headers.get("Location");
    if (!location) throw new PrivateError(502, "DRIVE_REQUEST_FAILED");
    this.sessionPath(location);
    return location;
  }
  private sessionPath(session: string): string {
    const url = new URL(session);
    if (
      url.origin !== "https://www.googleapis.com" ||
      !url.pathname.startsWith("/upload/drive/v3/files") ||
      !url.searchParams.has("upload_id")
    )
      throw new PrivateError(502, "INVALID_UPLOAD_SESSION");
    return url.pathname.slice(1) + url.search;
  }
  async offset(
    session: string,
    total: number,
  ): Promise<{ offset: number; complete: boolean }> {
    const r = await this.request(this.sessionPath(session), {
      method: "PUT",
      headers: { "Content-Range": `bytes */${total}`, "Content-Length": "0" },
    });
    return {
      offset:
        r.status === 308
          ? Number(r.headers.get("Range")?.match(/bytes=0-(\d+)/)?.[1] ?? -1) +
            1
          : total,
      complete: r.status !== 308,
    };
  }
  async chunk(
    session: string,
    bytes: ArrayBuffer,
    start: number,
    total: number,
    mime: string,
  ): Promise<{ offset: number; complete: boolean }> {
    const r = await this.request(this.sessionPath(session), {
      method: "PUT",
      headers: {
        "Content-Range": `bytes ${start}-${start + bytes.byteLength - 1}/${total}`,
        "Content-Type": mime,
      },
      body: bytes,
    });
    return {
      offset:
        r.status === 308
          ? Number(r.headers.get("Range")?.match(/bytes=0-(\d+)/)?.[1] ?? -1) +
            1
          : total,
      complete: r.status !== 308,
    };
  }
  async verify(input: {
    id: string;
    bytes: number;
    sha256: string;
    mime: string;
    folder: string;
    allowedPermissionIds: string[];
  }): Promise<DriveMetadata> {
    const m = await this.metadata(input.id),
      perms = await this.permissions(input.id);
    if (
      m.trashed ||
      Number(m.size) !== input.bytes ||
      m.mimeType !== input.mime ||
      !m.parents?.includes(input.folder)
    )
      throw new PrivateError(409, "DRIVE_INTEGRITY_FAILED");
    if (
      !perms.length ||
      perms.some(
        (p) => p.type !== "user" || !input.allowedPermissionIds.includes(p.id),
      )
    )
      throw new PrivateError(403, "DRIVE_NOT_PRIVATE");
    let checksum = m.sha256Checksum;
    if (!checksum) {
      const data = await readBounded(
        await this.download(input.id),
        input.bytes,
      );
      if (data.byteLength !== input.bytes)
        throw new PrivateError(409, "DRIVE_INTEGRITY_FAILED");
      checksum = await digest(data);
    }
    if (checksum.toLowerCase() !== input.sha256)
      throw new PrivateError(409, "DRIVE_INTEGRITY_FAILED");
    return m;
  }
  download(id: string): Promise<Response> {
    return this.request(`drive/v3/files/${encodeURIComponent(id)}?alt=media`);
  }
}
export async function refreshDriveToken(
  connection: DriveConnection,
  env: PrivateEnv,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  if (!env.PRIVATE_DRIVE_CLIENT_ID || !env.PRIVATE_DRIVE_CLIENT_SECRET)
    throw new PrivateError(503, "DRIVE_NOT_CONFIGURED");
  const refresh = await unseal(connection.refresh_token_encrypted, env);
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.PRIVATE_DRIVE_CLIENT_ID,
      client_secret: env.PRIVATE_DRIVE_CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(20000),
    redirect: "error",
  });
  const body = (await response.json()) as { access_token?: string };
  if (!response.ok || !body.access_token)
    throw new PrivateError(401, "DRIVE_RECONNECT");
  return body.access_token;
}
export function validFilePrefix(bytes: ArrayBuffer, mime: string): boolean {
  const b = new Uint8Array(bytes),
    ascii = new TextDecoder().decode(b.slice(0, 12));
  if (mime === "application/pdf") return ascii.startsWith("%PDF-");
  if (mime === "image/png")
    return [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => b[i] === n);
  if (mime === "image/jpeg")
    return b[0] === 255 && b[1] === 216 && b[2] === 255;
  if (mime === "image/webp")
    return ascii.startsWith("RIFF") && ascii.slice(8) === "WEBP";
  return false;
}
