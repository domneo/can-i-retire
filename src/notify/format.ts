// Telegram-ready summaries of a draw. Pure formatting, no I/O, so the shape
// of a report message is testable without a network or a database.

import { displayDate } from "../scrape/date.js";
import type { TotoDraw } from "../scrape/parse-toto.js";
import type { FourDDraw } from "../scrape/parse-4d.js";

const MONEY = new Intl.NumberFormat("en-SG", { useGrouping: true });

/** 585378200 -> "$5,853,782". Cents appear only when there are any. */
export function dollars(cents: number | null): string {
  if (cents === null) return "-";
  const whole = Math.trunc(cents / 100);
  const frac = Math.abs(cents % 100);
  const body = MONEY.format(whole);
  return frac === 0 ? `$${body}` : `$${body}.${String(frac).padStart(2, "0")}`;
}

/** One label-and-value table, on one line so a cut at a newline never splits it. */
function drawTable(caption: string, rows: [string, string][]): string {
  return (
    `<table bordered compact><caption>${caption}</caption>` +
    rows.map(([label, value]) => `<tr><th>${label}</th><td>${value}</td></tr>`).join("") +
    "</table>"
  );
}

const caption = (game: string, drawNo: number, date: string): string =>
  `<b>${game} Draw #${drawNo}</b> · ${displayDate(date)}`;

/**
 * A TOTO draw as a rich HTML table: winning numbers, additional number,
 * Group 1 prize, and any flags. Everything is digits, dates or fixed copy, so
 * nothing needs escaping.
 *
 * `cascadeDraw` is not on the draw: nothing in the results markup says so, it
 * comes from the cascade draw list alongside it.
 */
export function totoTable(draw: TotoDraw, cascadeDraw = false): string {
  const flags = [
    draw.snowballed ? "Snowballed" : null,
    cascadeDraw ? "Cascade" : null,
  ].filter((f) => f !== null);

  return drawTable(caption("TOTO", draw.drawNo, draw.drawDate), [
    ["Winning", `<code>${draw.numbers.join(" ")}</code>`],
    ["Additional", `<code>${draw.additional}</code>`],
    ["Group 1", dollars(draw.group1PrizeCents)],
    ...(flags.length > 0 ? [["Notes", flags.join(", ")] as [string, string]] : []),
  ]);
}

/** A 4D draw as a rich HTML table of its top three. */
export function fourdTable(draw: FourDDraw): string {
  return drawTable(caption("4D", draw.drawNo, draw.drawDate), [
    ["1st", `<code>${draw.first}</code>`],
    ["2nd", `<code>${draw.second}</code>`],
    ["3rd", `<code>${draw.third}</code>`],
  ]);
}
