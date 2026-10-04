// The bot's statements: users, saved tickets, and the 4D prize schedule it
// quotes.

import type { ResultSet } from "@libsql/client";
import { db } from "./client.js";
import type { FourDPrize, FourDTier } from "../bot/evaluate.js";
import { canonical, parseTicket, type Ticket } from "../bot/ticket.js";

const rows = <T>(rs: ResultSet): T[] => rs.rows as unknown as T[];

/** A /retire looks at no more than this many saved tickets. */
export const TICKET_LIMIT = 10;

export interface SavedTicket {
  ticket: Ticket;
  /** The draw it was saved for, as an SGT calendar date. */
  drawDate: string;
}

/**
 * Create the user on first contact. A later update refreshes the chat id,
 * which is the same as the user id for a private chat but is what a push has
 * to address.
 */
export async function upsertUser(telegramUserId: number, chatId: number): Promise<void> {
  await db.execute({
    sql: `INSERT INTO users (telegram_user_id, chat_id) VALUES (?, ?)
          ON CONFLICT (telegram_user_id) DO UPDATE SET chat_id = excluded.chat_id`,
    args: [telegramUserId, chatId],
  });
}

/**
 * Save a ticket for the draw on `drawDate`. Returns false when that user had
 * already saved the same numbers for the same draw.
 */
export async function saveTicket(
  telegramUserId: number,
  ticket: Ticket,
  drawDate: string,
): Promise<boolean> {
  const rs = await db.execute({
    sql: `INSERT OR IGNORE INTO tickets (telegram_user_id, game, numbers, draw_date, source)
          VALUES (?, ?, ?, ?, 'text')`,
    args: [telegramUserId, ticket.game, canonical(ticket), drawDate],
  });
  return rs.rowsAffected === 1;
}

/** The user's saved tickets, newest draw first, then in the order saved. */
export async function savedTickets(telegramUserId: number): Promise<SavedTicket[]> {
  const rs = await db.execute({
    sql: `SELECT numbers, draw_date FROM tickets
          WHERE telegram_user_id = ? AND draw_date IS NOT NULL
          ORDER BY draw_date DESC, id
          LIMIT ?`,
    args: [telegramUserId, TICKET_LIMIT],
  });
  // Stored as canonical text, so parsing it again cannot fail; a row that
  // somehow does is skipped rather than checked as something else.
  return rows<{ numbers: string; draw_date: string }>(rs).flatMap((r) => {
    const parsed = parseTicket(r.numbers);
    return parsed.kind === "ticket" ? [{ ticket: parsed.ticket, drawDate: r.draw_date }] : [];
  });
}

/**
 * The per-$1 payouts in force on `drawDate`: the newest schedule whose
 * effective_from is on or before it. Empty for a draw older than any.
 */
export async function fourdSchedule(drawDate: string): Promise<FourDPrize[]> {
  const rs = await db.execute({
    sql: `SELECT prize_tier, big_cents, small_cents FROM fourd_prize_schedule
          WHERE effective_from = (
            SELECT MAX(effective_from) FROM fourd_prize_schedule
            WHERE effective_from <= ?
          )`,
    args: [drawDate],
  });
  return rows<{ prize_tier: FourDTier; big_cents: number; small_cents: number | null }>(
    rs,
  ).map((r) => ({ tier: r.prize_tier, bigCents: r.big_cents, smallCents: r.small_cents }));
}
