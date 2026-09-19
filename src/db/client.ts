import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrate } from "./migrate.js";

const DB_PATH = process.env.SGPOOLS_DB ?? "data/data.db";

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

// Pragmas are per-connection, not stored in the file. They belong here, right
// after opening, and nowhere else. foreign_keys in particular defaults to off
// and stays off silently.
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

// Migrations run on open, before any module gets a chance to prepare a
// statement against a table that does not exist yet. Idempotent, and
// microseconds once applied.
export const appliedMigrations = migrate(db);
