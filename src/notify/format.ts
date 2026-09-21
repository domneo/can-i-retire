// Human-readable one-liners for a draw. Pure formatting, no I/O, so the shape
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

/**
 * `TOTO 4217 · Mon 14 Sep 2026 · 6 7 8 16 18 35 (+31) · Group 1 $3,106,055`
 *
 * `cascadeDraw` is not on the draw: nothing in the results markup says so, it
 * comes from the cascade draw list alongside it.
 */
export function totoLine(draw: TotoDraw, cascadeDraw = false): string {
  const flags = [
    draw.snowballed ? "snowballed" : null,
    cascadeDraw ? "cascade" : null,
  ].filter((f) => f !== null);

  return [
    `TOTO ${draw.drawNo}`,
    displayDate(draw.drawDate),
    `${draw.numbers.join(" ")} (+${draw.additional})`,
    `Group 1 ${dollars(draw.group1PrizeCents)}`,
    ...(flags.length > 0 ? [`[${flags.join(", ")}]`] : []),
  ].join(" · ");
}

/** `4D 5536 · Sat 19 Sep 2026 · 1st 1234 · 2nd 5678 · 3rd 9012` */
export function fourdLine(draw: FourDDraw): string {
  return [
    `4D ${draw.drawNo}`,
    displayDate(draw.drawDate),
    `1st ${draw.first}`,
    `2nd ${draw.second}`,
    `3rd ${draw.third}`,
  ].join(" · ");
}
