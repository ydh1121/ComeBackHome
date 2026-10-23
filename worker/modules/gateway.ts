import { handleApiRequest } from "../api";
import type { WorkerEnv } from "../runtime-types";
import type { ProviderSourceBundle } from "../providers/contracts";
import { authenticate, handleAuth, authAudit } from "./auth/service";
import { assertSameOrigin, PrivateError, privateJson } from "./auth/contracts";
import { handleCase } from "./injury/service";

// This adapter alone connects independent private modules to the legacy API.
export async function handleProductRequest(
  request: Request,
  env: WorkerEnv,
  providers: ProviderSourceBundle | null = null,
  driveFetch: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname;
  if (env.PRIVATE_WORK_ENABLED !== "1") {
    if (path === "/api/auth/session" && request.method === "GET")
      return privateJson({ enabled: false, user: null });
    if (path.startsWith("/api/auth/") || path.startsWith("/api/private/"))
      return privateJson({ error: "FEATURE_UNAVAILABLE" }, 404);
    return handleApiRequest(request, env, providers);
  }
  // Existing authenticated machine ingress is not a browser session.
  if (
    (path === "/api/health" && request.method === "GET") ||
    path === "/api/internal/scheduler-tick" ||
    (path === "/api/presence-events" && request.method === "POST")
  )
    return handleApiRequest(request, env, providers);
  try {
    assertSameOrigin(request);
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      env.MUTATIONS_ENABLED === "0"
    )
      throw new PrivateError(503, "WRITES_DISABLED");
    if (path.startsWith("/api/auth/"))
      return await handleAuth(request, env, path.slice("/api/auth/".length));
    const principal = await authenticate(request, env);
    if (path === "/api/private/case" || path.startsWith("/api/private/case/"))
      return await handleCase(
        request,
        env,
        principal,
        path.slice("/api/private/case".length).split("/").filter(Boolean),
        driveFetch,
      );
    if (path.startsWith("/api/private/"))
      throw new PrivateError(404, "NOT_FOUND");
    const grant = await env.DB.prepare(
      "SELECT permission FROM auth_workspace_grants WHERE user_id=?1 AND workspace='legacy'",
    )
      .bind(principal.id)
      .first<{ permission: string }>();
    if (
      !grant ||
      (!["GET", "HEAD"].includes(request.method) &&
        grant.permission !== "write")
    ) {
      await authAudit(env.DB, principal.id, "legacy-access", "denied");
      throw new PrivateError(403, "WORKSPACE_ACCESS_REQUIRED");
    }
    const response = await handleApiRequest(request, env, providers),
      headers = new Headers(response.headers);
    headers.set("Cache-Control", "private, no-store");
    headers.set("Vary", "Cookie");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    if (error instanceof PrivateError)
      return privateJson({ error: error.code }, error.status);
    // Never reflect SQL, file names, credentials or provider response bodies.
    return privateJson({ error: "PRIVATE_SERVICE_UNAVAILABLE" }, 503);
  }
}
