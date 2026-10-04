// `pnpm run migrate`. Applies pending migrations to whichever database the env
// names: Turso when TURSO_DATABASE_URL is set, data/data.db otherwise.

import { db } from "./client.js";
import { migrate } from "./migrate.js";

const applied = await migrate(db);
console.log(applied.length ? `applied: ${applied.join(", ")}` : "already up to date");
