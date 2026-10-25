import { PrivateError } from "./contracts";
import { PASSWORD_ITERATIONS } from "../../../src/modules/auth/password-policy";
export { PASSWORD_ITERATIONS, validPassword } from "../../../src/modules/auth/password-policy";

export function encode64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
export function decode64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
export function randomToken(): string {
  return encode64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
export async function digest(value: string | ArrayBuffer): Promise<string> {
  const data =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export interface PasswordHash {
  algorithm: "pbkdf2-sha256";
  iterations: number;
  salt_b64: string;
  hash_b64: string;
}
export async function hashPassword(
  password: string,
  salt = crypto.getRandomValues(new Uint8Array(16)),
): Promise<PasswordHash> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  let hash: ArrayBuffer;
  try {
    hash = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", iterations: PASSWORD_ITERATIONS, salt },
      key,
      256,
    );
  } catch (error) {
    // workerd local tests do not enforce the production PBKDF2 iteration cap.
    // Classify only the known provider error; never return its raw message or
    // retry with a weaker work factor / another credential format.
    if (
      error instanceof Error &&
      error.name === "NotSupportedError" &&
      /^Pbkdf2 failed: iteration counts above \d+ are not supported \(requested 600000\)\.$/.test(error.message)
    )
      throw new PrivateError(503, "AUTH_PASSWORD_RUNTIME_UNSUPPORTED");
    throw error;
  }
  return {
    algorithm: "pbkdf2-sha256",
    iterations: PASSWORD_ITERATIONS,
    salt_b64: encode64(salt),
    hash_b64: encode64(new Uint8Array(hash)),
  };
}
export async function verifyPassword(
  password: string,
  stored: PasswordHash,
): Promise<boolean> {
  if (
    stored.algorithm !== "pbkdf2-sha256" ||
    stored.iterations !== PASSWORD_ITERATIONS
  )
    throw new Error("PASSWORD_FORMAT_UNSUPPORTED");
  const salt = decode64(stored.salt_b64),
    expected = decode64(stored.hash_b64);
  if (salt.length !== 16 || expected.length !== 32)
    throw new Error("PASSWORD_FORMAT_UNSUPPORTED");
  const actual = decode64((await hashPassword(password, salt)).hash_b64);
  let difference = 0;
  for (let i = 0; i < 32; i++) difference |= actual[i] ^ expected[i];
  return difference === 0;
}
