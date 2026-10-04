// `pnpm dev` / `pnpm start`. Serves the app on a local port. Vercel does not
// use this file; it imports the app from src/index.ts directly.

import { serve } from "@hono/node-server";
import { app } from "./index.js";

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`listening on http://localhost:${info.port}`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
