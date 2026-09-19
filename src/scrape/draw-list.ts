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

/**
 * Draw numbers missing from an otherwise contiguous list.
 *
 * Cascade and Hongbao draws share the main sequence, so a healthy list has no
 * gaps at all. A gap is therefore either a real event or a wrong assumption —
 * worth reporting, but not worth refusing to back fill over, since the list
 * itself is what gets enumerated either way.
 */
export function findGaps(entries: DrawListEntry[]): number[] {
  const present = new Set(entries.map((e) => e.drawNo));
  const gaps: number[] = [];
  for (let n = Math.min(...present) + 1; n < Math.max(...present); n++) {
    if (!present.has(n)) gaps.push(n);
  }
  return gaps;
}
