// pnpm run scrape [toto|4d]  —  fetch the most recent draw of each game.
// The work is in ./latest.ts, which the deployed cron route also runs.

import { scrapeLatest } from "./latest.js";
import type { Game } from "../scrape/url.js";

const arg = process.argv[2];
const games: Game[] = arg === "toto" || arg === "4d" ? [arg] : ["toto", "4d"];

// Sequentially: the fetch limiter is process-wide anyway, and one report per
// game arrives in a readable order.
for (const game of games) {
  const run = await scrapeLatest(game, "manual");
  if (run.status !== "ok") process.exitCode = 1;
}
