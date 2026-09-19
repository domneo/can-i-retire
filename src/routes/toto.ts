import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { latestToto, totoByDrawNo } from "../db/queries.js";
import { DrawNoParam, ErrorSchema, TotoDrawSchema } from "../schema/draw.js";

const json = (
  schema: typeof TotoDrawSchema | typeof ErrorSchema,
  description: string,
) => ({
  content: { "application/json": { schema } },
  description,
});

const latest = createRoute({
  method: "get",
  path: "/toto/latest",
  tags: ["toto"],
  summary: "Most recent stored TOTO draw",
  responses: {
    200: json(TotoDrawSchema, "The latest draw"),
    404: json(ErrorSchema, "Nothing scraped yet"),
  },
});

// Registered after /toto/latest so the literal path wins over the parameter.
const byDrawNo = createRoute({
  method: "get",
  path: "/toto/{drawNo}",
  tags: ["toto"],
  summary: "One TOTO draw by draw number",
  request: { params: DrawNoParam },
  responses: {
    200: json(TotoDrawSchema, "The requested draw"),
    404: json(ErrorSchema, "No such draw stored"),
  },
});

export const toto = new OpenAPIHono()
  .openapi(latest, (c) => {
    const draw = latestToto();
    if (!draw)
      return c.json(
        { error: "no TOTO draws stored — run `pnpm run scrape`" },
        404,
      );
    return c.json(draw, 200);
  })
  .openapi(byDrawNo, (c) => {
    const { drawNo } = c.req.valid("param");
    const draw = totoByDrawNo(drawNo);
    if (!draw) return c.json({ error: `TOTO draw ${drawNo} not stored` }, 404);
    return c.json(draw, 200);
  });
