// The deployed scrape. Vercel Cron calls GET /cron/scrape once a day (see
// vercel.json) with `Authorization: Bearer $CRON_SECRET`.
//
// Not an OpenAPI route: it is an operator endpoint, not part of the API.

import { Hono } from "hono";
import { scrapeLatest } from "../jobs/latest.js";
import type { Game } from "../scrape/url.js";

const GAMES: Game[] = ["toto", "4d"];

export const cron = new Hono().get("/cron/scrape", async (c) => {
  // Fail closed: with no secret configured, nobody gets to trigger a scrape.
  const secret = process.env.CRON_SECRET;
  if (!secret || c.req.header("authorization") !== `Bearer ${secret}`) {
    return c.json({ error: "unauthorized" }, 401);
  }

  // Sequentially, as the CLI does: the fetch limiter is process-wide, and the
  // reports arrive in a readable order.
  const runs = [];
  for (const game of GAMES) {
    const run = await scrapeLatest(game, "scheduled");
    runs.push({ game, status: run.status, draws: run.draws_written, error: run.error });
  }

  // Vercel does not retry a failed cron, so the status code is for the logs.
  // The Telegram report has already said what went wrong.
  const ok = runs.every((r) => r.status === "ok");
  return c.json({ runs }, ok ? 200 : 500);
});
