export const PASSWORD_PROTOCOL = "cbh-pbkdf2-relief/v1";
export const PASSWORD_ITERATIONS = 600_000;
export const SERVER_PASSWORD_ITERATIONS = 10_000;

export function validPassword(value: unknown): value is string {
  return typeof value === "string" && [...value].length >= 15 &&
    [...value].length <= 128 && !/^(.)\1+$/.test(value);
}
