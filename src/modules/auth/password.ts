import { ApiError, privateRequest } from "./client";
import { PASSWORD_ITERATIONS, PASSWORD_PROTOCOL, validPassword } from "./password-policy";

interface Parameters { protocol: string; iterations: number; salt: string }
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
function saltBytes(value: unknown) {
  if (typeof value !== "string" || value.length !== 24) throw new ApiError("CLIENT_UPDATE_REQUIRED", 426);
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
  catch { throw new ApiError("CLIENT_UPDATE_REQUIRED", 426); }
  if (bytes.length !== 16 || encode(bytes) !== value) throw new ApiError("CLIENT_UPDATE_REQUIRED", 426);
  return bytes;
}
export async function derivePasswordMaterial(password: string, params: Parameters) {
  if (params.protocol !== PASSWORD_PROTOCOL || params.iterations !== PASSWORD_ITERATIONS)
    throw new ApiError("CLIENT_UPDATE_REQUIRED", 426);
  const salt = saltBytes(params.salt);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return encode(new Uint8Array(await crypto.subtle.deriveBits({
    name: "PBKDF2", hash: "SHA-256", iterations: PASSWORD_ITERATIONS, salt,
  }, key, 256)));
}

export async function loginWithPassword(input: { loginId: string; password: string; remember: boolean; deviceName: string }) {
  const params = await privateRequest<Parameters>("auth/login-parameters", "POST", { loginId: input.loginId });
  const material = await derivePasswordMaterial(input.password, params);
  return privateRequest("auth/login", "POST", {
    protocol: PASSWORD_PROTOCOL, loginId: input.loginId, material,
    salt: params.salt, remember: input.remember, deviceName: input.deviceName,
  });
}

export async function changeWithPassword(current: string, next: string) {
  if (current.length > 512 || !validPassword(next) || current === next)
    throw new ApiError("PASSWORD_INVALID", 400);
  const params = await privateRequest<Parameters>("auth/password-parameters");
  const newSalt = encode(crypto.getRandomValues(new Uint8Array(16)));
  const currentMaterial = await derivePasswordMaterial(current, params);
  const newMaterial = await derivePasswordMaterial(next, { ...params, salt: newSalt });
  return privateRequest("auth/password", "POST", {
    protocol: PASSWORD_PROTOCOL, salt: params.salt, currentMaterial, newMaterial, newSalt,
  });
}
