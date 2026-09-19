// Parser for the draw-list index files (see drawListUrl).
//
// The file is a single <select> and nothing else:
//   <option queryString='sppl=...' value='4217' winningSharesUploaded='True'
//           isCancelled=''>Mon, 14 Sep 2026</option>
//
// Draw numbers are contiguous and newest-first, so entry 0 is "latest" — no
// probing, and phase 3's backfill can walk a known-good list instead of
// guessing at draws-per-year.

import * as cheerio from "cheerio";
import { isoDate } from "./date.js";

export interface DrawListEntry {
  drawNo: number;
  drawDate: string;
  /** The site's own flag; cancelled draws have no results to parse. */
  cancelled: boolean;
}

export function parseDrawList(html: string): DrawListEntry[] {
  const $ = cheerio.load(html);
  const entries: DrawListEntry[] = [];

  $("option").each((_, el) => {
    const drawNo = Number($(el).attr("value"));
    if (!Number.isInteger(drawNo)) return;
    entries.push({
      drawNo,
      drawDate: isoDate($(el).text()),
      // cheerio lowercases attribute names in HTML mode, so the source's
      // `isCancelled` is only reachable as `iscancelled`. It is present but
      // empty on a normal draw.
      cancelled: Boolean($(el).attr("iscancelled")?.trim()),
    });
  });

  if (entries.length === 0) throw new Error("draw list contained no options");
  return entries;
}
