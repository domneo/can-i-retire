import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { latestDraw } from "./db/queries.js";

const app = new Hono();

app.get("/toto/latest", (c) => {
  const draw = latestDraw();
  if (!draw) {
    return c.json({ error: "no draws stored — run `pnpm run scrape`" }, 404);
  }
  return c.json(draw);
});

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`listening on http://localhost:${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
