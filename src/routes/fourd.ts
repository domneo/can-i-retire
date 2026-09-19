import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { fourdByDrawNo, latestFourd } from "../db/queries.js";
import { DrawNoParam, ErrorSchema, FourDDrawSchema } from "../schema/draw.js";

const json = (
  schema: typeof FourDDrawSchema | typeof ErrorSchema,
  description: string,
) => ({
  content: { "application/json": { schema } },
  description,
});

const latest = createRoute({
  method: "get",
  path: "/4d/latest",
  tags: ["4d"],
  summary: "Most recent stored 4D draw",
  responses: {
    200: json(FourDDrawSchema, "The latest draw"),
    404: json(ErrorSchema, "Nothing scraped yet"),
  },
});

const byDrawNo = createRoute({
  method: "get",
  path: "/4d/{drawNo}",
  tags: ["4d"],
  summary: "One 4D draw by draw number",
  request: { params: DrawNoParam },
  responses: {
    200: json(FourDDrawSchema, "The requested draw"),
    404: json(ErrorSchema, "No such draw stored"),
  },
});

export const fourd = new OpenAPIHono()
  .openapi(latest, (c) => {
    const draw = latestFourd();
    if (!draw)
      return c.json(
        { error: "no 4D draws stored — run `pnpm run scrape`" },
        404,
      );
    return c.json(draw, 200);
  })
  .openapi(byDrawNo, (c) => {
    const { drawNo } = c.req.valid("param");
    const draw = fourdByDrawNo(drawNo);
    if (!draw) return c.json({ error: `4D draw ${drawNo} not stored` }, 404);
    return c.json(draw, 200);
  });
