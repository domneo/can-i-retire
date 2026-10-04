// What the bot says. Pure formatting over evaluated tickets, so the copy is
// testable without Telegram or a database. Messages are HTML parse_mode.

import { InlineKeyboard } from "grammy";
import { dollars } from "../notify/format.js";
import { displayDate } from "../scrape/date.js";
import type { FourDDrawResponse, TotoDrawResponse } from "../schema/draw.js";
import type { Game } from "../scrape/url.js";
import {
  isWin,
  type FourDOutcome,
  type FourDWin,
  type Outcome,
  type TotoOutcome,
} from "./evaluate.js";
import type { DrawOptions, SavedDraw } from "./check.js";
import { encodeChoice } from "./choice.js";
import { canonical, FORMAT_RULE, type Ticket } from "./ticket.js";

/** One ticket, and what checking it against one draw found. */
export type Checked =
  | { ticket: Ticket; draw: TotoDrawResponse | FourDDrawResponse; outcome: Outcome }
  /** The draw is not stored, so there is nothing to check against. */
  | { ticket: Ticket; draw: null };

const GAME_NAME: Record<Game, string> = { toto: "TOTO", "4d": "4D" };

export const WELCOME =
  "Send your 4D or TOTO numbers, then pick the draw to check them against.\n\n" + FORMAT_RULE;

export const ASK_NUMBERS = `Provide draw numbers.\n\n${FORMAT_RULE}`;

export const PHOTO_UNSUPPORTED =
  `Photo tickets are not supported yet. Type the numbers instead.\n\n${FORMAT_RULE}`;

export const ERROR = "Something went wrong on my side. Try again in a minute.";

export const invalidTicket = (reason: string): string => `${reason}\n\n${FORMAT_RULE}`;

// --- picking a draw --------------------------------------------------------

const ticketLabel = (ticket: Ticket): string =>
  `<b>${GAME_NAME[ticket.game]}</b> ${canonical(ticket)}`;

export const pickDraw = (ticket: Ticket): string =>
  `Check ${ticketLabel(ticket)} against which draw?`;

/** The upcoming draw first, then stored draws newest first: one per row. */
export function drawKeyboard(ticket: Ticket, options: DrawOptions): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text(
      `${displayDate(options.upcoming)} · upcoming`,
      encodeChoice({ kind: "upcoming", date: options.upcoming, ticket }),
    )
    .row();
  for (const { drawNo, drawDate } of options.past) {
    keyboard.text(displayDate(drawDate), encodeChoice({ kind: "draw", drawNo, ticket })).row();
  }
  return keyboard;
}

export const notDrawnYet = (ticket: Ticket, date: string): string =>
  `<b>You cannot retire yet.</b>\n\n` +
  `The ${GAME_NAME[ticket.game]} draw on ${displayDate(date)} has not happened yet.\n` +
  `• ${canonical(ticket)}`;

/** Added under any reply to an "upcoming" press: the ticket is now saved. */
export const savedNote = (isNew: boolean): string =>
  (isNew ? "Ticket saved." : "This ticket is already saved.") +
  " Send /retire or “Can I retire?” to check your saved tickets.";

/** A button this bot did not write, or one from before a format change. */
export const STALE_BUTTON = `That button no longer works. Send your numbers again.`;

// --- results ---------------------------------------------------------------

function drawHeading(draw: TotoDrawResponse | FourDDrawResponse): string {
  const head = `<b>${GAME_NAME[draw.game]} ${draw.drawNo}</b> · ${displayDate(draw.drawDate)}`;
  return draw.game === "toto"
    ? `${head} · ${draw.numbers.join(" ")} (+${draw.additional})`
    : `${head} · 1st ${draw.first} · 2nd ${draw.second} · 3rd ${draw.third}`;
}

function totoResult(o: TotoOutcome): string {
  if (!isWin(o)) {
    const add = o.additionalMatched ? " + additional" : "";
    return `no prize (${o.matched} matched${add})`;
  }
  const groups = o.wins.map((w) => {
    const count = w.shares > 1 ? ` ×${w.shares}` : "";
    const amount = w.shareCents === null ? "amount not published" : dollars(w.shareCents);
    return `Group ${w.group}${count} ${amount}`;
  });
  // A total is only worth printing when it says more than the one share does.
  const multi = o.wins.length > 1 || o.wins[0]!.shares > 1;
  const total = multi && o.totalCents !== null ? ` = ${dollars(o.totalCents)}` : "";
  return groups.join(", ") + total;
}

const TIER_NAME: Record<FourDWin["tier"], string> = {
  "1st": "1st prize",
  "2nd": "2nd prize",
  "3rd": "3rd prize",
  starter: "Starter prize",
  consolation: "Consolation prize",
};

function fourdResult(o: FourDOutcome): string {
  if (!isWin(o)) return "no prize";
  return o.wins
    .map(({ tier, prize }) => {
      if (prize === null) return `${TIER_NAME[tier]} (amount not published)`;
      const small =
        prize.smallCents === null ? "Small pays nothing" : `${dollars(prize.smallCents)} Small`;
      return `${TIER_NAME[tier]}: ${dollars(prize.bigCents)} Big, ${small}, per $1`;
    })
    .join("; ");
}

type CheckedWithDraw = Extract<Checked, { draw: object }>;

const hasDraw = (c: Checked): c is CheckedWithDraw => c.draw !== null;

const resultLine = (c: CheckedWithDraw): string =>
  `• ${canonical(c.ticket)} — ${
    c.outcome.game === "toto" ? totoResult(c.outcome) : fourdResult(c.outcome)
  }`;

/**
 * The verdict, then the draw and the ticket's result under it.
 *
 * A draw that is not stored says so: it is never counted as a loss. That is
 * the PRD's one hard rule.
 */
export function resultMessage(checked: Checked): string {
  if (!hasDraw(checked)) {
    return [
      "<b>You cannot retire yet.</b>",
      "",
      `<b>${GAME_NAME[checked.ticket.game]}</b> · results not published yet`,
      `• ${canonical(checked.ticket)}`,
    ].join("\n");
  }
  const verdict = isWin(checked.outcome)
    ? "🎉 <b>You can retire!!!</b>"
    : "<b>You cannot retire yet.</b>";
  return [verdict, "", drawHeading(checked.draw), resultLine(checked)].join("\n");
}

// --- saved tickets ---------------------------------------------------------

function savedDrawBlock(d: SavedDraw): string {
  const first = d.checked[0]!;
  if (first.draw) {
    return [drawHeading(first.draw), ...d.checked.filter(hasDraw).map(resultLine)].join("\n");
  }
  const status = d.notDrawn ? "draw has not happened yet" : "results not published yet";
  return [
    `<b>${GAME_NAME[d.game]}</b> · ${displayDate(d.date)} · ${status}`,
    ...d.checked.map((c) => `• ${canonical(c.ticket)}`),
  ].join("\n");
}

/**
 * The /retire answer: one verdict over every saved ticket, then each draw
 * with its tickets under it. Any win is a win; a draw without stored results
 * is never counted as a loss.
 */
export function savedMessage(draws: SavedDraw[]): string {
  const won = draws.some((d) => d.checked.some((c) => hasDraw(c) && isWin(c.outcome)));
  const verdict = won ? "🎉 <b>You can retire!!!</b>" : "<b>You cannot retire yet.</b>";
  return [verdict, ...draws.map(savedDrawBlock), "Send numbers to add another ticket."].join(
    "\n\n",
  );
}
