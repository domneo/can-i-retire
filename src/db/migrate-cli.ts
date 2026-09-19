// `pnpm run migrate`. Opening the connection is what applies migrations; this
// only reports what that did.

import { appliedMigrations } from "./client.js";

console.log(
  appliedMigrations.length
    ? `applied: ${appliedMigrations.join(", ")}`
    : "already up to date",
);
