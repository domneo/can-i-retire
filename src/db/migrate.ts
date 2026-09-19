// Numbered .sql migration runner.
//
// Takes the connection as an argument rather than importing it: client.ts runs
// migrations as part of opening the database, and a module cycle between the
// two would be resolved differently depending on which one was imported first.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Database } from "better-sqlite3";

// Resolved from this module, not from cwd: src/db/ and dist/db/ are both two
// levels below the project root, so the same expression works either way.
const DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

/** Apply every migration not yet recorded. Returns the ones it applied. */
export function migrate(db: Database): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const done = new Set(
    (db.prepare("SELECT name FROM schema_migrations").all() as { name: string }[])
      .map((r) => r.name),
  );
  const pending = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => !done.has(f));

  const record = db.prepare("INSERT INTO schema_migrations (name) VALUES (?)");
  for (const name of pending) {
    const sql = readFileSync(DIR + name, "utf8");
    // All-or-nothing per file: transaction() rolls back and rethrows on error.
    db.transaction(() => {
      db.exec(sql);
      record.run(name);
    })();
  }
  return pending;
}
