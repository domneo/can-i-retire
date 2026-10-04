// The draw a user picked, carried in a button's callback data. Telegram allows
// 64 bytes; the longest choice (a System 12 against an upcoming date) is 48.
//
//   d:4217:2 14 16 21 36 47   a stored draw, by number
//   u:2026-10-08:0427         the upcoming draw, by date
//
// The ticket travels in the data, so nothing is stored between the question
// and the answer. It is parsed again on the way back: callback data comes
// from the client and is not trusted.

import { canonical, parseTicket, type Ticket } from "./ticket.js";

export type Choice =
  | { kind: "draw"; drawNo: number; ticket: Ticket }
  | { kind: "upcoming"; date: string; ticket: Ticket };

export function encodeChoice(choice: Choice): string {
  const at = choice.kind === "draw" ? `d:${choice.drawNo}` : `u:${choice.date}`;
  return `${at}:${canonical(choice.ticket)}`;
}

const CHOICE = /^(?:d:(\d{1,6})|u:(\d{4}-\d{2}-\d{2})):(.+)$/;

/** null for data this bot did not write. */
export function decodeChoice(data: string): Choice | null {
  const m = data.match(CHOICE);
  if (!m) return null;
  const parsed = parseTicket(m[3]!);
  if (parsed.kind !== "ticket") return null;
  const { ticket } = parsed;
  return m[1] !== undefined
    ? { kind: "draw", drawNo: Number(m[1]), ticket }
    : { kind: "upcoming", date: m[2]!, ticket };
}
