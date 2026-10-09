// What the bot says. Pure formatting over evaluated tickets, so the copy is
// testable without Telegram or a database. Prompts are HTML parse_mode; results
// are rich messages (rich HTML), so they can hold tables.

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

/** Fixed-width, and one tap copies it. Digits only, so nothing to escape. */
const ticketCode = (ticket: Ticket): string => `<code>${canonical(ticket)}</code>`;

const ticketLabel = (ticket: Ticket): string =>
  `<b>${GAME_NAME[ticket.game]}</b> ${ticketCode(ticket)}`;

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
  [
    para("<b>You cannot retire yet.</b>"),
    pendingTable(ticket.game, date, "draw has not happened yet", [ticket]),
  ].join("\n");

/** Added under any reply to an "upcoming" press: the ticket is now saved. */
export const savedNote = (isNew: boolean): string =>
  para(
    (isNew ? "Ticket saved." : "This ticket is already saved.") +
      " Send /retire or “Can I retire?” to check your saved tickets.",
  );

/** A button this bot did not write, or one from before a format change. */
export const STALE_BUTTON = `That button no longer works. Send your numbers again.`;

// --- results ---------------------------------------------------------------
//
// Results are rich messages (rich HTML): the draw is one table, the tickets
// checked against it another. Everything in a cell is digits, dates or fixed
// copy, so nothing needs escaping.

const para = (html: string): string => `<p>${html}</p>`;

const row = (cells: string[], tag: "td" | "th" = "td"): string =>
  `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`;

/** One row per line, so a message reads as its table in a test or a log. */
const table = (caption: string, head: string[], rows: string[][]): string =>
  [
    `<table bordered striped compact><caption>${caption}</caption>`,
    row(head, "th"),
    ...rows.map((r) => row(r)),
    "</table>",
  ].join("\n");

/** Every number the tickets hold: TOTO numbers, or 4D numbers as text. */
const held = (tickets: Ticket[]): Set<number | string> =>
  new Set(
    tickets.flatMap((t): (number | string)[] => (t.game === "toto" ? t.numbers : [t.number])),
  );

/** Bold when a ticket holds it, so a match shows without comparing by eye. */
const mark = (holds: Set<number | string>, value: number | string): string =>
  holds.has(value) ? `<b>${value}</b>` : String(value);

/** The draw's own numbers, with the ones the tickets hold in bold. */
function drawTable(draw: TotoDrawResponse | FourDDrawResponse, tickets: Ticket[]): string {
  const holds = held(tickets);
  const caption = `<b>${GAME_NAME[draw.game]} ${draw.drawNo}</b> · ${displayDate(draw.drawDate)}`;
  const rows =
    draw.game === "toto"
      ? [
          ["Winning", draw.numbers.map((n) => mark(holds, n)).join(" ")],
          ["Additional", mark(holds, draw.additional)],
        ]
      : [
          ["1st", mark(holds, draw.first)],
          ["2nd", mark(holds, draw.second)],
          ["3rd", mark(holds, draw.third)],
        ];
  return [
    `<table bordered compact><caption>${caption}</caption>`,
    ...rows.map(([label, value]) => `<tr><th>${label}</th><td>${value}</td></tr>`),
    "</table>",
  ].join("\n");
}

function totoPrize(o: TotoOutcome): string {
  if (!isWin(o)) return "No prize";
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

const totoMatched = (o: TotoOutcome): string =>
  `${o.matched}${o.additionalMatched ? " + additional" : ""}`;

const TIER_NAME: Record<FourDWin["tier"], string> = {
  "1st": "1st prize",
  "2nd": "2nd prize",
  "3rd": "3rd prize",
  starter: "Starter",
  consolation: "Consolation",
};

/** One row per prize the number won; a loss is one "No prize" row. */
function fourdRows(code: string, o: FourDOutcome): string[][] {
  if (!isWin(o)) return [[code, "No prize", "–", "–"]];
  return o.wins.map(({ tier, prize }) => {
    if (prize === null) return [code, TIER_NAME[tier], "not published", "not published"];
    const small = prize.smallCents === null ? "nothing" : dollars(prize.smallCents);
    return [code, `<b>${TIER_NAME[tier]}</b>`, dollars(prize.bigCents), small];
  });
}

type CheckedWithDraw = Extract<Checked, { draw: object }>;

const hasDraw = (c: Checked): c is CheckedWithDraw => c.draw !== null;

/** The tickets checked against one draw, all of the same game. */
function ticketTable(checked: CheckedWithDraw[]): string {
  if (checked[0]!.ticket.game === "toto") {
    return table(
      "Your tickets",
      ["Ticket", "Matched", "Prize"],
      checked.map(({ ticket, outcome }) => {
        const o = outcome as TotoOutcome;
        const prize = isWin(o) ? `<b>${totoPrize(o)}</b>` : totoPrize(o);
        return [ticketCode(ticket), totoMatched(o), prize];
      }),
    );
  }
  // Big or Small is not asked for, so a win quotes both payouts.
  return table(
    "Your tickets · prize per $1 bet",
    ["Ticket", "Prize", "Big", "Small"],
    checked.flatMap(({ ticket, outcome }) =>
      fourdRows(ticketCode(ticket), outcome as FourDOutcome),
    ),
  );
}

/**
 * Tickets for a draw with no stored results: the status is the caption.
 * `date` is null when only a draw number is known.
 */
const pendingTable = (
  game: Game,
  date: string | null,
  status: string,
  tickets: Ticket[],
): string =>
  table(
    [`<b>${GAME_NAME[game]}</b>`, ...(date ? [displayDate(date)] : []), status].join(" · "),
    ["Ticket"],
    tickets.map((t) => [ticketCode(t)]),
  );

const verdict = (won: boolean): string =>
  para(won ? "🎉 <b>You can retire!!!</b>" : "<b>You cannot retire yet.</b>");

/**
 * The verdict, then the draw and the ticket's result under it.
 *
 * A draw that is not stored says so: it is never counted as a loss. That is
 * the PRD's one hard rule.
 */
export function resultMessage(checked: Checked): string {
  if (!hasDraw(checked)) {
    return [
      verdict(false),
      pendingTable(checked.ticket.game, null, "results not published yet", [checked.ticket]),
    ].join("\n");
  }
  return [
    verdict(isWin(checked.outcome)),
    drawTable(checked.draw, [checked.ticket]),
    ticketTable([checked]),
  ].join("\n");
}

// --- saved tickets ---------------------------------------------------------

function savedDrawBlock(d: SavedDraw): string {
  const tickets = d.checked.map((c) => c.ticket);
  const first = d.checked[0]!;
  if (first.draw) {
    return [drawTable(first.draw, tickets), ticketTable(d.checked.filter(hasDraw))].join("\n");
  }
  const status = d.notDrawn ? "draw has not happened yet" : "results not published yet";
  return pendingTable(d.game, d.date, status, tickets);
}

/**
 * The /retire answer: one verdict over every saved ticket, then each draw
 * with its tickets under it. Any win is a win; a draw without stored results
 * is never counted as a loss.
 */
export function savedMessage(draws: SavedDraw[]): string {
  const won = draws.some((d) => d.checked.some((c) => hasDraw(c) && isWin(c.outcome)));
  return [
    verdict(won),
    draws.map(savedDrawBlock).join("\n<hr/>\n"),
    para("Send numbers to add another ticket."),
  ].join("\n");
}
