// Check tickets against the latest stored draw of their game: the one place
// the bot's reads meet the evaluator.

import { latestFourd, latestToto } from "../db/queries.js";
import { fourdSchedule } from "../db/tickets.js";
import { evaluateFourd, evaluateToto } from "./evaluate.js";
import type { Checked } from "./reply.js";
import type { Ticket } from "./ticket.js";

/**
 * Each game's latest draw is read once, however many tickets need it, and
 * only if some ticket does.
 *
 * Unbound tickets only, for now: every typed ticket is. A draw-bound ticket
 * (from a photo) will need its own draw read, and the on-demand scrape when
 * that draw is missing.
 */
export async function checkTickets(tickets: Ticket[]): Promise<Checked[]> {
  const needs = (game: Ticket["game"]) => tickets.some((t) => t.game === game);
  const [toto, fourd] = await Promise.all([
    needs("toto") ? latestToto() : undefined,
    needs("4d") ? latestFourd() : undefined,
  ]);
  const schedule = fourd ? await fourdSchedule(fourd.drawDate) : [];

  return tickets.map((ticket): Checked => {
    if (ticket.game === "toto") {
      return toto
        ? { ticket, draw: toto, outcome: evaluateToto(ticket.numbers, toto) }
        : { ticket, draw: null };
    }
    return fourd
      ? { ticket, draw: fourd, outcome: evaluateFourd(ticket.number, fourd, schedule) }
      : { ticket, draw: null };
  });
}
