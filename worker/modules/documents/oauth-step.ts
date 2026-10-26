import { PrivateError } from "../auth/contracts";

export type DriveOAuthStep = "state" | "key" | "token" | "token-body" | "identity" | "connection" | "audit";
const codes: Record<DriveOAuthStep, string> = {
  state: "DRIVE_CALLBACK_STATE_STORE",
  key: "DRIVE_KEY_UNAVAILABLE",
  token: "DRIVE_CALLBACK_PROVIDER",
  "token-body": "DRIVE_CALLBACK_RESPONSE",
  identity: "DRIVE_CALLBACK_IDENTITY",
  connection: "DRIVE_CALLBACK_CONNECTION_STORE",
  audit: "DRIVE_CALLBACK_AUDIT",
};

// Persist a fixed phase only in the existing private case audit. Never include
// URLs, code/state, tokens, provider bodies, exception messages or stack traces.
export async function driveOAuthStep<T>(
  step: DriveOAuthStep,
  operation: () => Promise<T>,
  recordFailure: (step: DriveOAuthStep) => Promise<void>,
): Promise<T> {
  try { return await operation(); }
  catch (error) {
    await recordFailure(step).catch(() => {});
    if (error instanceof PrivateError) throw error;
    throw new PrivateError(503, codes[step]);
  }
}
