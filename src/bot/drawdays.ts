// When the next draw is. Pure: "now" comes in as an argument.
//
// Regular draw days only. Special draws (cascade, Hongbao) land on other days
// and are not predictable, so they never show as upcoming; once scraped they
// show like any other stored draw.

import type { Game } from "../scrape/url.js";

/** Weekdays as Date.getUTCDay() numbers: 0 is Sunday. */
const DRAW_DAYS: Record<Game, number[]> = {
  toto: [1, 4], // Mon, Thu
  "4d": [0, 3, 6], // Sun, Wed, Sat
};

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Today's calendar date in Singapore, as ISO text. */
export const sgtToday = (now: Date): string =>
  new Date(now.getTime() + SGT_OFFSET_MS).toISOString().slice(0, 10);

const nextDay = (iso: string): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * The first regular draw day that is today or later and after the newest
 * stored draw. A draw whose results are stored is never "upcoming", even when
 * it was today.
 */
export function upcomingDrawDate(game: Game, latestStored: string | undefined, now: Date): string {
  const today = sgtToday(now);
  let date = latestStored && latestStored >= today ? nextDay(latestStored) : today;
  while (!DRAW_DAYS[game].includes(new Date(`${date}T00:00:00Z`).getUTCDay())) {
    date = nextDay(date);
  }
  return date;
}
