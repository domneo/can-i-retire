// The app. Vercel deploys this file's default export as a function; locally,
// src/serve.ts wraps it in a Node server.

import { OpenAPIHono } from "@hono/zod-openapi";
// Vercel finds its entrypoint by looking for a file that imports `hono`
// itself; importing it only through @hono/zod-openapi does not count. This
// loads nothing that OpenAPIHono has not already loaded.
import "hono";
import { cron } from "./routes/cron.js";
import { fourd } from "./routes/fourd.js";
import { telegram } from "./routes/telegram.js";
import { toto } from "./routes/toto.js";

// defaultHook turns a Zod failure into a 400 instead of letting it become a
// 500. Phase 6 replaces this body with RFC 9457 problem+json.
export const app = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        { error: `invalid request: ${result.error.issues[0]?.message}` },
        400,
      );
    }
  },
});

app.route("/", toto);
app.route("/", fourd);
app.route("/", cron);
app.route("/", telegram);

// `app.doc()` and a docs UI land in phase 6, over these same schemas.

export default app;
