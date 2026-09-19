// pnpm run scrape [toto|4d]  —  fetch the most recent draw of each game.
//
// "Latest" comes from the site's own draw-list index, not from probing: the
// list is authoritative, and the 4D results page without an sppl parameter
// renders client-side and returns an empty results block to a plain client.

import { archive, fetchPage } from "../scrape/fetch.js";
import { parseDrawList } from "../scrape/draw-list.js";
import { parse4d } from "../scrape/parse-4d.js";
import { parseToto } from "../scrape/parse-toto.js";
import { contentHash } from "../scrape/hash.js";
import { drawListUrl, drawUrl, type Game } from "../scrape/url.js";
import { writeFourd, writeToto, type WriteMeta } from "../db/queries.js";

const arg = process.argv[2];
const games: Game[] = arg === "toto" || arg === "4d" ? [arg] : ["toto", "4d"];

async function latestDrawNo(game: Game): Promise<number> {
  const entries = parseDrawList(await fetchPage(drawListUrl(game)));
  // Newest first, and a cancelled draw has no results to parse.
  const entry = entries.find((e) => !e.cancelled);
  if (!entry) throw new Error(`${game}: draw list had no uncancelled draws`);
  return entry.drawNo;
}

/** Draw numbers the site lists as cascade draws. TOTO only. */
async function cascadeDrawNos(): Promise<Set<number>> {
  const entries = parseDrawList(await fetchPage(drawListUrl("toto-cascade")));
  return new Set(entries.map((e) => e.drawNo));
}

for (const game of games) {
  const drawNo = await latestDrawNo(game);
  const html = await fetchPage(drawUrl(game, drawNo));
  const rawPath = await archive(game, drawNo, html);

  if (game === "toto") {
    const draw = parseToto(html);
    // The site quietly serves the latest draw when it does not recognise an
    // sppl, so what came back must be what was asked for.
    if (draw.drawNo !== drawNo) {
      throw new Error(`asked for TOTO ${drawNo}, page returned ${draw.drawNo}`);
    }
    const meta: WriteMeta = {
      rawPath,
      contentHash: contentHash(draw),
      cascadeDraw: (await cascadeDrawNos()).has(drawNo),
    };
    writeToto(draw, meta);
    console.log(
      `toto ${draw.drawNo} (${draw.drawDate}): ${draw.numbers.join(" ")} + ` +
        `${draw.additional}${draw.snowballed ? " [snowballed]" : ""}` +
        `${meta.cascadeDraw ? " [cascade]" : ""}  raw: ${rawPath}`,
    );
  }

  if (game === "4d") {
    const draw = parse4d(html);
    if (draw.drawNo !== drawNo) {
      throw new Error(`asked for 4D ${drawNo}, page returned ${draw.drawNo}`);
    }
    const meta: WriteMeta = {
      rawPath,
      contentHash: contentHash(draw),
    };
    writeFourd(draw, meta);
    console.log(
      `4d   ${draw.drawNo} (${draw.drawDate}): ${draw.first} ${draw.second} ` +
        `${draw.third}  +${draw.starter.length} starter +${draw.consolation.length} ` +
        `consolation  raw: ${rawPath}`,
    );
  }
}
