import { createClient } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Turso in deployment, a local SQLite file otherwise. Both speak the same
// dialect through the same client, so nothing above this module knows which
// one it is talking to.
const LOCAL_PATH = process.env.SGPOOLS_DB ?? "data/data.db";
const DB_URL = process.env.TURSO_DATABASE_URL ?? `file:${LOCAL_PATH}`;

if (DB_URL.startsWith("file:")) {
  mkdirSync(dirname(DB_URL.slice("file:".length)), { recursive: true });
}

export const db = createClient({
  url: DB_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Migrations no longer run on open. A serverless function opens a connection
// per cold start, and its bundle does not carry migrations/ anyway; schema
// changes go through `pnpm migrate`, against whichever database the env names.
