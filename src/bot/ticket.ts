// Read a ticket out of a typed message. Pure, so every accepted and rejected
// shape is testable without Telegram or a database.
//
// Anything ambiguous is rejected with the format rule, never guessed: a
// guessed ticket that "lost" is the one answer a user will not forgive.

import type { Game } from "../scrape/url.js";

export type Ticket =
  | { game: "toto"; numbers: number[] }
  | { game: "4d"; number: string };

export type ParseResult =
  | { kind: "ticket"; ticket: Ticket }
  /** Looked like numbers, but no valid ticket. `reason` is shown to the user. */
  | { kind: "invalid"; reason: string }
  /** Not numbers at all. */
  | { kind: "none" };

export const TOTO_MIN = 6;
export const TOTO_MAX = 12;

/** The format rule, as the user sees it. */
export const FORMAT_RULE =
  "4D: four digits, e.g. 0427.\n" +
  `TOTO: ${TOTO_MIN} to ${TOTO_MAX} different numbers from 1 to 49, e.g. 2 14 16 21 36 47.`;

export function parseTicket(text: string): ParseResult {
  const tokens = text.trim().split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0 || !tokens.every((t) => /^\d+$/.test(t))) {
    return { kind: "none" };
  }

  // One four-digit token is 4D. Its digits are kept as text: 0427 ≠ 427.
  if (tokens.length === 1) {
    const [t] = tokens as [string];
    if (t.length === 4) return { kind: "ticket", ticket: { game: "4d", number: t } };
    return { kind: "invalid", reason: "One number is a 4D ticket, and needs exactly four digits." };
  }

  // Several four-digit numbers are several 4D tickets, or a typo — not TOTO,
  // whose numbers never exceed two digits.
  if (tokens.some((t) => t.length > 2)) {
    return { kind: "invalid", reason: "Send one 4D number per message." };
  }

  const numbers = tokens.map(Number);
  if (numbers.some((n) => n < 1 || n > 49)) {
    return { kind: "invalid", reason: "TOTO numbers run from 1 to 49." };
  }
  if (new Set(numbers).size !== numbers.length) {
    return { kind: "invalid", reason: "A TOTO ticket cannot repeat a number." };
  }
  if (numbers.length < TOTO_MIN || numbers.length > TOTO_MAX) {
    return {
      kind: "invalid",
      reason: `A TOTO ticket has ${TOTO_MIN} to ${TOTO_MAX} numbers; that was ${numbers.length}.`,
    };
  }
  return {
    kind: "ticket",
    ticket: { game: "toto", numbers: numbers.sort((a, b) => a - b) },
  };
}

/** The `tickets.numbers` text for a ticket. */
export function canonical(ticket: Ticket): string {
  return ticket.game === "toto" ? ticket.numbers.join(" ") : ticket.number;
}

/** The inverse of `canonical`, for a row read back from `tickets`. */
export function fromRow(game: Game, numbers: string): Ticket {
  return game === "toto"
    ? { game, numbers: numbers.split(" ").map(Number) }
    : { game, number: numbers };
}
