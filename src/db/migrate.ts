// Numbered .sql migration runner.
//
// Takes the client as an argument rather than importing it, so a test can
// point it at an in-memory database it opened itself.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Client } from "@libsql/client";

// Resolved from this module, not from cwd: src/db/ and dist/db/ are both two
// levels below the project root, so the same expression works either way.
const DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

/** Apply every migration not yet recorded. Returns the ones it applied. */
export async function migrate(db: Client): Promise<string[]> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const done = new Set(
    (await db.execute("SELECT name FROM schema_migrations")).rows.map(
      (r) => r.name as string,
    ),
  );
  const pending = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => !done.has(f));

  for (const name of pending) {
    const sql = readFileSync(DIR + name, "utf8");
    // All-or-nothing per file. executeMultiple stops at a failing statement
    // but does not roll back by itself, so the catch does.
    const tx = await db.transaction("write");
    try {
      await tx.executeMultiple(sql);
      await tx.execute({
        sql: "INSERT INTO schema_migrations (name) VALUES (?)",
        args: [name],
      });
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    } finally {
      tx.close();
    }
  }
  return pending;
}
