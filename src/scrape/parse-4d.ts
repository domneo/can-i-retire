// 4D results parser. Selectors verified against draw 5017 (Wed, 24 May 2023).
//
// The block is much simpler than TOTO's: three prize cells by class, then two
// tbodies of ten numbers each laid out two per row.
//
// Note the asymmetry with TOTO: requesting the 4D page WITHOUT an sppl returns
// an empty .divSingleDraw, because that view is populated client-side. Always
// resolve a draw number from the draw list first.

import * as cheerio from "cheerio";
import { isoDate } from "./date.js";
import { NoSuchDrawError } from "./errors.js";

export interface FourDDraw {
  drawNo: number;
  drawDate: string;
  first: string;
  second: string;
  third: string;
  /** Ten numbers, in page reading order (left to right, top to bottom). */
  starter: string[];
  consolation: string[];
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** 4D numbers stay strings all the way through: '0427' must not become 427. */
function fourDigits(text: string, what: string): string {
  const t = clean(text);
  if (!/^\d{4}$/.test(t)) {
    throw new Error(`bad 4D number for ${what}: ${JSON.stringify(t)}`);
  }
  return t;
}

export function parse4d(html: string): FourDDraw {
  const $ = cheerio.load(html);
  const root = $(".divSingleDraw").first();
  // An empty div is the shape the site returns for "no such draw" and for the
  // unparameterised page alike, so treat length-0 content as a miss too.
  if (root.length === 0 || root.children().length === 0) throw new NoSuchDrawError();

  const drawNoText = clean(root.find("th.drawNumber").first().text());
  const drawNo = Number(drawNoText.match(/(\d+)/)?.[1]);
  if (!Number.isInteger(drawNo)) {
    throw new Error(`no draw number in ${JSON.stringify(drawNoText)}`);
  }

  const drawDate = isoDate(root.find("th.drawDate").first().text());

  const tier = (cls: string, what: string) =>
    fourDigits(root.find(`td.${cls}`).first().text(), what);

  const column = (cls: string, what: string): string[] => {
    const cells = root.find(`tbody.${cls} td`);
    const numbers = cells
      .toArray()
      .map((td, i) => fourDigits($(td).text(), `${what} #${i + 1}`));
    if (numbers.length !== 10) {
      throw new Error(`expected 10 ${what} numbers, found ${numbers.length}`);
    }
    return numbers;
  };

  return {
    drawNo,
    drawDate,
    first: tier("tdFirstPrize", "1st prize"),
    second: tier("tdSecondPrize", "2nd prize"),
    third: tier("tdThirdPrize", "3rd prize"),
    starter: column("tbodyStarterPrizes", "starter"),
    consolation: column("tbodyConsolationPrizes", "consolation"),
  };
}
