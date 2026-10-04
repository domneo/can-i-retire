// The bot's statements: users, and the 4D prize schedule it quotes.

import type { ResultSet } from "@libsql/client";
import { db } from "./client.js";
import type { FourDPrize, FourDTier } from "../bot/evaluate.js";

const rows = <T>(rs: ResultSet): T[] => rs.rows as unknown as T[];

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
