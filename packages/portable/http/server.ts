export type JsonObject = Record<string, unknown>;

export function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function readObject(request: Request): Promise<JsonObject> {
  const body = await request.json();
  if (!isObject(body)) throw new Error('JSON object body is required.');
  return body;
}

export function asString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(name + ' is required.');
  return value.trim();
}

export function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function asBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(name + ' must be boolean.');
  return value;
}

