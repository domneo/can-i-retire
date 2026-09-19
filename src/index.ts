import { serve } from "@hono/node-server";
import { OpenAPIHono } from "@hono/zod-openapi";
import { fourd } from "./routes/fourd.js";
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

// `app.doc()` and a docs UI land in phase 6, over these same schemas.

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 3000);
  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`listening on http://localhost:${info.port}`);
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
