// The bot's reads: which draws a ticket can be checked against, and the check
// itself. The one place the bot's reads meet the evaluator.

import { drawNoOn, fourdByDrawNo, recentDraws, totoByDrawNo } from "../db/queries.js";
import { fourdSchedule } from "../db/tickets.js";
import type { Game } from "../scrape/url.js";
import { sgtToday, upcomingDrawDate } from "./drawdays.js";
import { evaluateFourd, evaluateToto } from "./evaluate.js";
import type { Checked } from "./reply.js";
import type { Ticket } from "./ticket.js";

/** How many past draws a ticket is offered against. */
export const PAST_DRAWS = 4;

export interface DrawOptions {
  /** Newest first. Fewer than PAST_DRAWS, or none, when fewer are stored. */
  past: { drawNo: number; drawDate: string }[];
  upcoming: string;
}

export async function drawOptions(game: Game, now: Date): Promise<DrawOptions> {
  const past = await recentDraws(game, PAST_DRAWS);
  return { past, upcoming: upcomingDrawDate(game, past[0]?.drawDate, now) };
}

/** `draw: null` when that draw is not stored: never reported as a loss. */
export async function checkDraw(ticket: Ticket, drawNo: number): Promise<Checked> {
  if (ticket.game === "toto") {
    const draw = await totoByDrawNo(drawNo);
    return draw
      ? { ticket, draw, outcome: evaluateToto(ticket.numbers, draw) }
      : { ticket, draw: null };
  }
  const draw = await fourdByDrawNo(drawNo);
  if (!draw) return { ticket, draw: null };
  const schedule = await fourdSchedule(draw.drawDate);
  return { ticket, draw, outcome: evaluateFourd(ticket.number, draw, schedule) };
}

/**
 * A press on an "upcoming" button. The button may be days old: once that
 * draw is stored it is checked like any other, and once its date has passed
 * without results it is "not published yet", never "not happened".
 */
export async function checkUpcoming(
  ticket: Ticket,
  date: string,
  now: Date,
): Promise<Checked | "not drawn"> {
  const drawNo = await drawNoOn(ticket.game, date);
  if (drawNo !== undefined) return checkDraw(ticket, drawNo);
  return date < sgtToday(now) ? { ticket, draw: null } : "not drawn";
}
