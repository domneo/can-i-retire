// The bot's reads: which draws a ticket can be checked against, and the check
// itself. The one place the bot's reads meet the evaluator.

import {
  drawNoOn,
  fourdByDrawNo,
  latestFourd,
  latestToto,
  recentDraws,
  totoByDrawNo,
} from "../db/queries.js";
import { fourdSchedule, ticketsSince } from "../db/tickets.js";
import type { FourDDrawResponse, TotoDrawResponse } from "../schema/draw.js";
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

type Draw = TotoDrawResponse | FourDDrawResponse;

/** Checks tickets of the draw's game against it. */
async function checkerFor(draw: Draw): Promise<(ticket: Ticket) => Checked> {
  if (draw.game === "toto") {
    return (ticket) =>
      ticket.game === "toto"
        ? { ticket, draw, outcome: evaluateToto(ticket.numbers, draw) }
        : { ticket, draw: null };
  }
  const schedule = await fourdSchedule(draw.drawDate);
  return (ticket) =>
    ticket.game === "4d"
      ? { ticket, draw, outcome: evaluateFourd(ticket.number, draw, schedule) }
      : { ticket, draw: null };
}

/** Checks tickets of one game against one draw, or null if it is not stored. */
async function drawChecker(
  game: Game,
  drawNo: number,
): Promise<((ticket: Ticket) => Checked) | null> {
  const draw = game === "toto" ? await totoByDrawNo(drawNo) : await fourdByDrawNo(drawNo);
  return draw ? checkerFor(draw) : null;
}

/** `draw: null` when that draw is not stored: never reported as a loss. */
export async function checkDraw(ticket: Ticket, drawNo: number): Promise<Checked> {
  const check = await drawChecker(ticket.game, drawNo);
  return check ? check(ticket) : { ticket, draw: null };
}

/**
 * Whether `drawNo` is the newest stored draw of its game: the only stored draw
 * whose saved tickets /retire shows.
 */
export async function isLatestDraw(game: Game, drawNo: number): Promise<boolean> {
  const [latest] = await recentDraws(game, 1);
  return latest?.drawNo === drawNo;
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

/** A draw with no stored results, and the user's tickets saved for it. */
export interface PendingDraw {
  game: Game;
  date: string;
  /** The date is today or later. Otherwise its results are just not stored. */
  notDrawn: boolean;
  /** In the order saved. Empty when none are saved. */
  tickets: Ticket[];
}

/** The newest stored draw of a game, and the user's tickets checked against it. */
export interface LatestDraw {
  draw: Draw;
  /** In the order saved. Empty when none are saved. */
  checked: Extract<Checked, { draw: object }>[];
}

/** The /retire answer: TOTO before 4D in each part. */
export interface Overview {
  /**
   * Per game, every draw after the newest stored one that has saved tickets,
   * oldest first, and always the upcoming draw.
   */
  pending: PendingDraw[];
  /** Per game with a stored draw. */
  latest: LatestDraw[];
}

const GAMES: Game[] = ["toto", "4d"];

/**
 * Tickets saved for draws older than the newest stored one are not shown. A
 * ticket for a draw after it always is, whether the draw is upcoming or its
 * results are missing: an unresolved ticket is never dropped silently.
 */
export async function checkOverview(telegramUserId: number, now: Date): Promise<Overview> {
  const [toto, fourd] = await Promise.all([latestToto(), latestFourd()]);
  const latest: Record<Game, Draw | undefined> = { toto, "4d": fourd };
  const saved = await ticketsSince(telegramUserId, {
    toto: toto?.drawDate ?? "",
    "4d": fourd?.drawDate ?? "",
  });
  const today = sgtToday(now);

  const pending = GAMES.flatMap((game): PendingDraw[] => {
    const after = latest[game]?.drawDate ?? "";
    const forGame = saved.filter((s) => s.ticket.game === game && s.drawDate > after);
    const dates = new Set([
      ...forGame.map((s) => s.drawDate),
      upcomingDrawDate(game, latest[game]?.drawDate, now),
    ]);
    return [...dates].sort().map((date) => ({
      game,
      date,
      notDrawn: date >= today,
      tickets: forGame.filter((s) => s.drawDate === date).map((s) => s.ticket),
    }));
  });

  const stored = GAMES.flatMap((game) => latest[game] ?? []);
  return {
    pending,
    latest: await Promise.all(
      stored.map(async (draw) => {
        const check = await checkerFor(draw);
        const checked = saved
          .filter((s) => s.ticket.game === draw.game && s.drawDate === draw.drawDate)
          .map((s) => check(s.ticket))
          .filter((c): c is LatestDraw["checked"][number] => c.draw !== null);
        return { draw, checked };
      }),
    ),
  };
}
