import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.SGPOOLS_DB ?? "data/data.db";

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

// WAL so a scrape run and the server can hold the file open at the same time.
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Phase 1 is one table created in place. Phase 2 replaces this with numbered
// migration files under migrations/ and a runner.
db.exec(`
  CREATE TABLE IF NOT EXISTS draws (
    draw_no    INTEGER PRIMARY KEY,
    draw_date  TEXT    NOT NULL,
    numbers    TEXT    NOT NULL,
    additional INTEGER NOT NULL
  );
`);
