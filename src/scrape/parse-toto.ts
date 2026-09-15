// TOTO results parser. Selectors verified in phase 0 against draws 4099 and 4100.
//
// Everything is scoped under `.divSingleDraw`. The page also carries an
// unrelated script block with a stale `var DrawNo = '3554'`, so any whole-page
// regex for a draw number matches the wrong thing.

import * as cheerio from "cheerio";

export interface PrizeGroup {
  group: number;
  shareCents: number | null;
  winners: number | null;
}

export interface Outlet {
  group: number;
  name: string;
  address: string | null;
  entry: string | null;
}

export interface TotoDraw {
  drawNo: number;
  drawDate: string;
  numbers: number[];
  additional: number;
  group1PrizeCents: number | null;
  snowballed: boolean;
  prizeGroups: PrizeGroup[];
  outlets: Outlet[];
}

/** Thrown when the page loads but carries no results block. */
export class NoSuchDrawError extends Error {
  constructor(message = "page served no results block") {
    super(message);
    this.name = "NoSuchDrawError";
  }
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
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

export function parseToto(html: string): TotoDraw {
  const $ = cheerio.load(html);
  const root = $(".divSingleDraw").first();
  if (root.length === 0) throw new NoSuchDrawError();

  const drawNoText = clean(root.find("th.drawNumber").first().text());
  const drawNo = Number(drawNoText.match(/(\d+)/)?.[1]);
  if (!Number.isInteger(drawNo)) {
    throw new Error(`no draw number in ${JSON.stringify(drawNoText)}`);
  }

  const drawDate = isoDate(root.find("th.drawDate").first().text());

  const numbers = [1, 2, 3, 4, 5, 6].map((i) => {
    const t = clean(root.find(`td.win${i}`).first().text());
    const n = Number(t);
    if (!Number.isInteger(n)) {
      throw new Error(`bad winning number at position ${i}: ${JSON.stringify(t)}`);
    }
    return n;
  });

  const additional = Number(clean(root.find("td.additional").first().text()));
  if (!Number.isInteger(additional)) throw new Error("no additional number");

  const group1PrizeCents = cents(root.find("td.jackpotPrize").first().text());

  // The winning-shares tbody opens with a header row of <th>, not <td>.
  const prizeGroups: PrizeGroup[] = [];
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

  // Outlets are flat siblings: <p><strong>Group N winning tickets sold at:</strong></p>
  // followed by a <ul>. Track the current group while walking them in order.
  const outletsBlock = root.find(".divWinningOutlets").first();
  const snowballed = /snowball/i.test(outletsBlock.text());

  const outlets: Outlet[] = [];
  let currentGroup: number | null = null;
  outletsBlock.find("p, ul").each((_, el) => {
    const tag = el.tagName?.toLowerCase();
    if (tag === "p") {
      const m = clean($(el).text()).match(/Group\s+(\d+)\s+winning tickets sold at/i);
      currentGroup = m ? Number(m[1]) : null;
      return;
    }
    if (tag === "ul" && currentGroup !== null) {
      const group = currentGroup;
      $(el).find("li").each((__, li) => {
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
