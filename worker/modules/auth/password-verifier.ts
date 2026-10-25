import { decode64, encode64, type PasswordHash } from "./crypto";
import { PrivateError } from "./contracts";
import { PASSWORD_ITERATIONS, SERVER_PASSWORD_ITERATIONS } from "../../../src/modules/auth/password-policy";

// Versioned binary envelope in the existing TEXT hash_b64 column. The original
// 600k client KDF and its salt stay intact; only its output is wrapped by a
// second salted server KDF. No directly usable client material remains in D1.
// See docs/private-work/architecture.md (server relief and migration boundary).
const MARKER = new Uint8Array([67, 66, 72, 83, 82, 48, 49, 0]); // CBHSR01\0
const WRAPPED_BYTES = 56;

export function material64(value: unknown, bytes: number): Uint8Array<ArrayBuffer> | null {
  if (typeof value !== "string" || value.length !== Math.ceil(bytes / 3) * 4) return null;
  try {
    const decoded = decode64(value);
    return decoded.length === bytes && encode64(decoded) === value ? decoded : null;
  } catch { return null; }
}

export function passwordRecord(stored: PasswordHash) {
  const clientSalt = material64(stored.salt_b64, 16);
  if (stored.algorithm !== "pbkdf2-sha256" || stored.iterations !== PASSWORD_ITERATIONS || !clientSalt)
    throw new PrivateError(503, "AUTH_PASSWORD_RECORD_INVALID");
  const legacy = material64(stored.hash_b64, 32);
  if (legacy) return { version: 1 as const, clientSalt, legacy };
  const envelope = material64(stored.hash_b64, WRAPPED_BYTES);
  if (!envelope || !MARKER.every((b, i) => envelope[i] === b))
    throw new PrivateError(503, "AUTH_PASSWORD_RECORD_INVALID");
  return { version: 2 as const, clientSalt, serverSalt: envelope.slice(8, 24), verifier: envelope.slice(24) };
}

async function serverHash(material: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveBits"]);
  try {
    return new Uint8Array(await crypto.subtle.deriveBits({
      name: "PBKDF2", hash: "SHA-256", iterations: SERVER_PASSWORD_ITERATIONS, salt,
    }, key, 256));
  } catch (error) {
    if (error instanceof Error && error.name === "NotSupportedError" &&
      /^Pbkdf2 failed: iteration counts above \d+ are not supported \(requested 10000\)\.$/.test(error.message))
      throw new PrivateError(503, "AUTH_PASSWORD_RUNTIME_UNSUPPORTED");
    throw error;
  }
}

export async function passwordVerifier(
  material: Uint8Array<ArrayBuffer>, clientSalt: Uint8Array<ArrayBuffer>,
  serverSalt = crypto.getRandomValues(new Uint8Array(16)),
): Promise<PasswordHash> {
  if (material.length !== 32 || clientSalt.length !== 16 || serverSalt.length !== 16)
    throw new PrivateError(400, "PASSWORD_INVALID");
  const verifier = await serverHash(material, serverSalt), envelope = new Uint8Array(WRAPPED_BYTES);
  envelope.set(MARKER); envelope.set(serverSalt, 8); envelope.set(verifier, 24);
  return { algorithm: "pbkdf2-sha256", iterations: PASSWORD_ITERATIONS,
    salt_b64: encode64(clientSalt), hash_b64: encode64(envelope) };
}

export async function wrapLegacyPassword(stored: PasswordHash): Promise<PasswordHash> {
  const record = passwordRecord(stored);
  if (record.version === 2) return stored;
  return passwordVerifier(record.legacy, record.clientSalt);
}

export async function verifyPasswordMaterial(material: unknown, stored: PasswordHash): Promise<boolean> {
  const record = passwordRecord(stored), input = material64(material, 32);
  // Never compare network input directly with a legacy stored 600k hash.
  if (record.version !== 2) throw new PrivateError(503, "AUTH_PASSWORD_UPGRADE_REQUIRED");
  const actual = await serverHash(input ?? new Uint8Array(32), record.serverSalt);
  let difference = 0;
  for (let i = 0; i < 32; i++) difference |= actual[i] ^ record.verifier[i];
  return input !== null && difference === 0;
}
