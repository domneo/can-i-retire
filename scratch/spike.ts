// scratch/spike.ts — npx tsx scratch/spike.ts 4099
//
// Phase 0: one file, one draw. No database, no server, no framework.
// The URL helper here gets promoted to src/scrape/url.ts in phase 1.

import * as cheerio from "cheerio";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const UA = "can-i-retire/0.1 (personal archive; contact: dom.neo.ws@gmail.com)";

const drawUrl = (drawNo: number) =>
  "https://www.singaporepools.com.sg/en/product/sr/Pages/toto_results.aspx?sppl=" +
  encodeURIComponent(Buffer.from(`DrawNumber=${drawNo}`).toString("base64"));

// --- helpers ---------------------------------------------------------------

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "Mon, 28 Jul 2025" -> "2025-07-28" */
function isoDate(text: string): string {
  const m = clean(text).match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (!m) throw new Error(`unparseable draw date: ${JSON.stringify(text)}`);
  const month = MONTHS.indexOf(m[2]!);
  if (month < 0) throw new Error(`unknown month: ${m[2]}`);
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
}

/** "$5,853,782" -> 585378200 cents. "-" / "" -> null. */
function cents(text: string): number | null {
  const t = clean(text);
  if (!t || t === "-") return null;
  const m = t.match(/\$?\s*([\d,]+)(?:\.(\d{1,2}))?/);
  if (!m) return null;
  const dollars = Number(m[1]!.replace(/,/g, ""));
  const frac = Number((m[2] ?? "").padEnd(2, "0") || "0");
  return dollars * 100 + frac;
}

/** "214,301" -> 214301. "-" -> null. */
function count(text: string): number | null {
  const t = clean(text);
  if (!t || t === "-") return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// --- extraction ------------------------------------------------------------

export interface TotoDraw {
  drawNo: number;
  drawDate: string;
  numbers: number[];
  additional: number;
  group1PrizeCents: number | null;
  snowballed: boolean;
  prizeGroups: {
    group: number;
    shareCents: number | null;
    winners: number | null;
  }[];
  outlets: {
    group: number;
    name: string;
    address: string | null;
    entry: string | null;
  }[];
}

export function extractToto($: cheerio.CheerioAPI): TotoDraw {
  const root = $(".divSingleDraw").first();
  if (root.length === 0)
    throw new Error("no .divSingleDraw block — page served no results");

  const drawNoText = clean(root.find("th.drawNumber").first().text());
  const drawNo = Number(drawNoText.match(/(\d+)/)?.[1]);
  if (!Number.isInteger(drawNo))
    throw new Error(`no draw number in ${JSON.stringify(drawNoText)}`);

  const drawDate = isoDate(root.find("th.drawDate").first().text());

  const numbers = [1, 2, 3, 4, 5, 6].map((i) => {
    const t = clean(root.find(`td.win${i}`).first().text());
    const n = Number(t);
    if (!Number.isInteger(n))
      throw new Error(
        `bad winning number at position ${i}: ${JSON.stringify(t)}`,
      );
    return n;
  });

  const additional = Number(clean(root.find("td.additional").first().text()));
  if (!Number.isInteger(additional)) throw new Error("no additional number");

  const group1PrizeCents = cents(root.find("td.jackpotPrize").first().text());

  // Winning-shares table: first tbody row is a header row of <th>, skip it.
  const prizeGroups: TotoDraw["prizeGroups"] = [];
  root.find("table.tableWinningShares tbody tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 3) return;
    const group = Number(clean(tds.eq(0).text()).match(/(\d+)/)?.[1]);
    if (!Number.isInteger(group)) return;
    prizeGroups.push({
      group,
      shareCents: cents(tds.eq(1).text()),
      winners: count(tds.eq(2).text()),
    });
  });

  // Outlets: a <p><strong>Group N winning tickets sold at:</strong></p> followed by a <ul>.
  const outletsBlock = root.find(".divWinningOutlets").first();
  const snowballed = /snowball/i.test(outletsBlock.text());

  const outlets: TotoDraw["outlets"] = [];
  let currentGroup: number | null = null;
  outletsBlock.find("p, ul").each((_, el) => {
    const tag = el.tagName?.toLowerCase();
    if (tag === "p") {
      const m = clean($(el).text()).match(
        /Group\s+(\d+)\s+winning tickets sold at/i,
      );
      currentGroup = m ? Number(m[1]) : null;
      return;
    }
    if (tag === "ul" && currentGroup !== null) {
      const group = currentGroup;
      $(el)
        .find("li")
        .each((__, li) => {
          const text = clean($(li).text());
          if (!text) return;
          // "Name - Address ( 1 QuickPick System 7 Entry )" — address may be a bare "-".
          const entry = text.match(/\(([^()]*)\)\s*$/)?.[1];
          const head = clean(text.replace(/\([^()]*\)\s*$/, ""));
          const parts = head.split(/\s+-\s+/);
          const name = clean(parts[0] ?? head);
          const address = clean(parts.slice(1).join(" - "));
          outlets.push({
            group,
            name,
            address: address && address !== "-" ? address : null,
            entry: entry ? clean(entry) : null,
          });
        });
    }
  });

  return {
    drawNo,
    drawDate,
    numbers,
    additional,
    group1PrizeCents,
    snowballed,
    prizeGroups,
    outlets,
  };
}

// --- main ------------------------------------------------------------------

const drawNo = Number(process.argv[2] ?? 4099);
if (!Number.isInteger(drawNo)) {
  console.error("usage: tsx scratch/spike.ts <drawNo>");
  process.exit(2);
}

const cachePath = `testdata/toto/${drawNo}.html`;
let html: string;
try {
  html = await readFile(cachePath, "utf8");
  console.error(`[cache] ${cachePath}`);
} catch {
  const url = drawUrl(drawNo);
  console.error(`[fetch] ${url}`);
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  html = await res.text();
  await mkdir("testdata/toto", { recursive: true });
  await writeFile(cachePath, html);
  console.error(`[saved] ${cachePath}`);
}

console.log(JSON.stringify(extractToto(cheerio.load(html)), null, 2));
