// Callback failures return to an ordinary authenticated app page. Never carry
// Google's code/state, provider response or a user-supplied redirect target.
export function driveReturn(result: string): Response {
  const allowed = ["connected", "cancelled", "expired", "session-ended", "owner-only", "account-changed", "not-configured", "provider-unavailable", "response-unavailable", "storage-unavailable", "key-unavailable", "service-unavailable", "failed"];
  const value = allowed.includes(result) ? result : "failed";
  return new Response(null, { status: 303, headers: {
    Location: "/injury?section=documents&drive=" + value,
    "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
  } });
}
export function driveFailure(code: string): Response {
  const outcomes: Record<string, string> = {
    OAUTH_STATE_EXPIRED: "expired", LOGIN_REQUIRED: "session-ended",
    PASSWORD_CHANGE_REQUIRED: "session-ended", OWNER_ONLY: "owner-only",
    CASE_ACCESS_DENIED: "owner-only", DRIVE_ACCOUNT_CHANGED: "account-changed",
    DRIVE_NOT_CONFIGURED: "not-configured",
    DRIVE_KEY_UNAVAILABLE: "key-unavailable",
    DRIVE_CALLBACK_PROVIDER: "provider-unavailable",
    DRIVE_CALLBACK_IDENTITY: "provider-unavailable",
    DRIVE_CALLBACK_RESPONSE: "response-unavailable",
    DRIVE_CALLBACK_STATE_STORE: "storage-unavailable",
    DRIVE_CALLBACK_CONNECTION_STORE: "storage-unavailable",
    DRIVE_CALLBACK_AUDIT: "storage-unavailable",
    unavailable: "service-unavailable",
  };
  return driveReturn(outcomes[code] ?? "failed");
}
