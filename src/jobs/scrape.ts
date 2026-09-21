// pnpm run scrape [toto|4d]  —  fetch the most recent draw of each game.
//
// "Latest" comes from the site's own draw-list index, not from probing: the
// list is authoritative, and the 4D results page without an sppl parameter
// renders client-side and returns an empty results block to a plain client.
//
// One game is one scrape_runs row and one Telegram report. Nothing throws out
// of a game any more: a failure is recorded and reported, because an
// unattended run that dies silently is indistinguishable from a quiet week.

import { archive, fetchPage } from "../scrape/fetch.js";
import { parseDrawList } from "../scrape/draw-list.js";
import { parse4d } from "../scrape/parse-4d.js";
import { parseToto } from "../scrape/parse-toto.js";
import { contentHash } from "../scrape/hash.js";
import { drawListUrl, drawUrl, type Game } from "../scrape/url.js";
import {
  finishRun,
  startRun,
  writeFourd,
  writeToto,
  type WriteMeta,
} from "../db/queries.js";
import { fourdLine, totoLine } from "../notify/format.js";
import { reportRun } from "../notify/report.js";

const arg = process.argv[2];
const games: Game[] = arg === "toto" || arg === "4d" ? [arg] : ["toto", "4d"];

/** A fetch that keeps the run's page count. */
type Fetcher = (url: string) => Promise<string>;

async function latestDrawNo(game: Game, get: Fetcher): Promise<number> {
  const entries = parseDrawList(await get(drawListUrl(game)));
  // Newest first, and a cancelled draw has no results to parse.
  const entry = entries.find((e) => !e.cancelled);
  if (!entry) throw new Error(`${game}: draw list had no uncancelled draws`);
  return entry.drawNo;
}

/** Draw numbers the site lists as cascade draws. TOTO only. */
async function cascadeDrawNos(get: Fetcher): Promise<Set<number>> {
  const entries = parseDrawList(await get(drawListUrl("toto-cascade")));
  return new Set(entries.map((e) => e.drawNo));
}

/**
 * The site quietly serves the latest draw when it does not recognise an sppl,
 * so what came back must be what was asked for.
 */
function assertDrawNoMatches(
  draw: { drawNo: number },
  asked: number,
  game: Game,
): void {
  if (draw.drawNo !== asked) {
    throw new Error(`asked for ${game} ${asked}, page returned ${draw.drawNo}`);
  }
}

async function scrapeGame(game: Game): Promise<void> {
  const runId = startRun("manual", game);
  let pages = 0;
  let written = 0;
  const draws: string[] = [];
  const failures: string[] = [];
  // Known as soon as the draw list is read, so a later parse failure can still
  // name the draw it broke on.
  let drawNo: number | undefined;

  const get: Fetcher = async (url) => {
    const html = await fetchPage(url);
    pages++;
    return html;
  };

  try {
    drawNo = await latestDrawNo(game, get);
    const html = await get(drawUrl(game, drawNo));
    const rawPath = await archive(game, drawNo, html);

    if (game === "toto") {
      const draw = parseToto(html);
      assertDrawNoMatches(draw, drawNo, game);
      const meta: WriteMeta = {
        rawPath,
        contentHash: contentHash(draw),
        cascadeDraw: (await cascadeDrawNos(get)).has(drawNo),
      };
      writeToto(draw, meta);
      written++;
      draws.push(totoLine(draw, meta.cascadeDraw));
      console.log(
        `toto ${draw.drawNo} (${draw.drawDate}): ${draw.numbers.join(" ")} + ` +
          `${draw.additional}${draw.snowballed ? " [snowballed]" : ""}` +
          `${meta.cascadeDraw ? " [cascade]" : ""}  raw: ${rawPath}`,
      );
    } else {
      const draw = parse4d(html);
      assertDrawNoMatches(draw, drawNo, game);
      writeFourd(draw, { rawPath, contentHash: contentHash(draw) });
      written++;
      draws.push(fourdLine(draw));
      console.log(
        `4d   ${draw.drawNo} (${draw.drawDate}): ${draw.first} ${draw.second} ` +
          `${draw.third}  +${draw.starter.length} starter +${draw.consolation.length} ` +
          `consolation  raw: ${rawPath}`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failures.push(`${game} ${drawNo ?? "?"}: ${message}`);
    console.error(`${game} ${drawNo ?? "?"} FAILED — ${message}`);
  }

  const run = finishRun(runId, {
    status: failures.length > 0 ? "error" : "ok",
    pagesFetched: pages,
    drawsWritten: written,
    error: failures.length > 0 ? failures.join("\n") : undefined,
  });
  await reportRun(run, draws);

  if (failures.length > 0) process.exitCode = 1;
}

// Sequentially: the fetch limiter is process-wide anyway, and one report per
// game arrives in a readable order.
for (const game of games) await scrapeGame(game);
