import type { D1DatabaseLike, D1PreparedStatementLike } from '../runtime-types';

export function utcNow(): string {
  return new Date().toISOString();
}

export function asBoolean(value: number): boolean {
  return value === 1;
}

export function asInteger(value: boolean): number {
  return value ? 1 : 0;
}

export async function batchOrThrow(db: D1DatabaseLike, statements: D1PreparedStatementLike[]): Promise<void> {
  if (!statements.length) return;
  const results = await db.batch(statements);
  if (results.some((result) => result.success === false)) {
    throw new Error('D1 batch operation failed.');
  }
}
