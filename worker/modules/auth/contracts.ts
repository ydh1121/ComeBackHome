import type { D1DatabaseLike } from "../../../packages/portable/d1/types";
export interface PrivateEnv {
  DB: D1DatabaseLike;
  PRIVATE_WORK_ENABLED?: string;
  MUTATIONS_ENABLED?: string;
  PRIVATE_DRIVE_CLIENT_ID?: string;
  PRIVATE_DRIVE_CLIENT_SECRET?: string;
  PRIVATE_DRIVE_TOKEN_KEY?: string;
  PRIVATE_DRIVE_PICKER_KEY?: string;
  PRIVATE_DRIVE_APP_ID?: string;
}
export interface Principal {
  id: string;
  loginId: string;
  role: "admin" | "member";
  mustChangePassword: boolean;
  sessionHash: string;
  authEpoch: number;
}
export class PrivateError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}
export function privateJson(
  value: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}
export async function readJson(
  request: Request,
): Promise<Record<string, unknown>> {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    throw new PrivateError(415, "JSON_REQUIRED");
  if (Number(request.headers.get("Content-Length") ?? 0) > 200000)
    throw new PrivateError(413, "REQUEST_TOO_LARGE");
  const text = new TextDecoder().decode(await readBounded(request, 200000));
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new PrivateError(400, "INVALID_JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PrivateError(400, "INVALID_JSON");
  return value as Record<string, unknown>;
}
export function assertSameOrigin(request: Request): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  if (request.headers.get("Origin") !== new URL(request.url).origin)
    throw new PrivateError(403, "ORIGIN_REJECTED");
  if (request.headers.get("Sec-Fetch-Site") === "cross-site")
    throw new PrivateError(403, "ORIGIN_REJECTED");
}

export async function readBounded(
  input: Request | Response,
  limit: number,
): Promise<ArrayBuffer> {
  if (Number(input.headers.get("Content-Length") ?? 0) > limit)
    throw new PrivateError(413, "REQUEST_TOO_LARGE");
  const reader = input.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new PrivateError(413, "REQUEST_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes.buffer;
}
