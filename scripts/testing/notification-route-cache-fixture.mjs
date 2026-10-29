import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';

// The same migration and SQL as production, isolated in private memory.
export async function cacheDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON; CREATE TABLE people(id TEXT PRIMARY KEY);');
  sqlite.exec(await readFile(new URL('../../db/migrations/0016_notification_route_cache.sql', import.meta.url), 'utf8'));
  const prepare = query => {
    let values = [];
    const statement = sqlite.prepare(query);
    // D1 uses numbered ?1 placeholders. node:sqlite binds them by name.
    const parameters = () => Object.fromEntries(values.map((value, index) => [String(index + 1), value]));
    return {
      bind(...input) { values = input; return this; },
      async first() { return statement.get(parameters()) ?? null; },
      async all() { return { results: statement.all(parameters()), success: true }; },
      async run() { return { results: statement.all(parameters()), success: true }; },
    };
  };
  return {
    sqlite,
    db: { prepare, async batch(statements) { return Promise.all(statements.map(statement => statement.run())); } },
    addPerson(id) { sqlite.prepare('INSERT OR IGNORE INTO people(id) VALUES (?)').run(id); },
    close() { sqlite.close(); },
  };
}
