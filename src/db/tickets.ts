// The bot's statements: users, tickets, and the 4D prize schedule it quotes.

import type { ResultSet } from "@libsql/client";
import { db } from "./client.js";
import type { Game } from "../scrape/url.js";
import type { FourDPrize, FourDTier } from "../bot/evaluate.js";

const rows = <T>(rs: ResultSet): T[] => rs.rows as unknown as T[];

/** A /retire looks at no more than this many tickets, newest first. */
export const TICKET_LIMIT = 10;

export interface TicketRow {
  id: number;
  game: Game;
  draw_no: number | null;
  numbers: string;
}

/**
 * Create the user on first contact. A later message updates the chat id,
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

/** Store an unbound typed ticket. Returns false when it was already stored. */
export async function addTicket(
  telegramUserId: number,
  game: Game,
  numbers: string,
): Promise<boolean> {
  const rs = await db.execute({
    sql: `INSERT OR IGNORE INTO tickets (telegram_user_id, game, numbers, source)
          VALUES (?, ?, ?, 'text')`,
    args: [telegramUserId, game, numbers],
  });
  return rs.rowsAffected === 1;
}

export async function ticketsFor(telegramUserId: number): Promise<TicketRow[]> {
  const rs = await db.execute({
    sql: `SELECT id, game, draw_no, numbers FROM tickets
          WHERE telegram_user_id = ?
          ORDER BY id DESC LIMIT ?`,
    args: [telegramUserId, TICKET_LIMIT],
  });
  return rows<TicketRow>(rs);
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
