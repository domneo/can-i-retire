// The bot's reads: which draws a ticket can be checked against, and the check
// itself. The one place the bot's reads meet the evaluator.

import { drawNoOn, fourdByDrawNo, recentDraws, totoByDrawNo } from "../db/queries.js";
import { fourdSchedule, type SavedTicket } from "../db/tickets.js";
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

/** Checks tickets of one game against one draw, or null if it is not stored. */
async function drawChecker(
  game: Game,
  drawNo: number,
): Promise<((ticket: Ticket) => Checked) | null> {
  if (game === "toto") {
    const draw = await totoByDrawNo(drawNo);
    if (!draw) return null;
    return (ticket) =>
      ticket.game === "toto"
        ? { ticket, draw, outcome: evaluateToto(ticket.numbers, draw) }
        : { ticket, draw: null };
  }
  const draw = await fourdByDrawNo(drawNo);
  if (!draw) return null;
  const schedule = await fourdSchedule(draw.drawDate);
  return (ticket) =>
    ticket.game === "4d"
      ? { ticket, draw, outcome: evaluateFourd(ticket.number, draw, schedule) }
      : { ticket, draw: null };
}

/** `draw: null` when that draw is not stored: never reported as a loss. */
export async function checkDraw(ticket: Ticket, drawNo: number): Promise<Checked> {
  const check = await drawChecker(ticket.game, drawNo);
  return check ? check(ticket) : { ticket, draw: null };
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

/** Every saved ticket for one draw, checked against it. */
export interface SavedDraw {
  game: Game;
  date: string;
  /** The date is today or later and no results are stored yet. */
  notDrawn: boolean;
  /** One per ticket, in the order saved. `draw: null` while not stored. */
  checked: Checked[];
}

/**
 * The /retire check: each saved ticket against the draw it was saved for.
 * Tickets for the same draw share one lookup. Draws keep the order of
 * `saved`, which is newest first.
 */
export async function checkSaved(saved: SavedTicket[], now: Date): Promise<SavedDraw[]> {
  const byDraw = new Map<string, { game: Game; date: string; tickets: Ticket[] }>();
  for (const { ticket, drawDate } of saved) {
    const key = `${ticket.game}:${drawDate}`;
    const group = byDraw.get(key) ?? { game: ticket.game, date: drawDate, tickets: [] };
    group.tickets.push(ticket);
    byDraw.set(key, group);
  }

  return Promise.all(
    [...byDraw.values()].map(async ({ game, date, tickets }) => {
      const drawNo = await drawNoOn(game, date);
      const check = drawNo === undefined ? null : await drawChecker(game, drawNo);
      return {
        game,
        date,
        notDrawn: !check && date >= sgtToday(now),
        checked: tickets.map((ticket) => (check ? check(ticket) : { ticket, draw: null })),
      };
    }),
  );
}
