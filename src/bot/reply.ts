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
import type { DrawOptions, LatestDraw, Overview, PendingDraw } from "./check.js";
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
    verdict(false),
    pendingTable(ticket.game, date, "draw has not happened yet", [ticket]),
  ].join("\n");

/**
 * Added under the reply to a press: the ticket is now saved. `listed` is false
 * for a draw older than the newest stored one, which /retire does not show.
 */
export const savedNote = (isNew: boolean, listed = true): string =>
  para(
    (isNew ? "Ticket saved." : "This ticket is already saved.") +
      (listed
        ? " Send /retire or “Can I retire?” to check your saved tickets."
        : " /retire shows only the latest draw, so it will not list this one."),
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
  `<tr>${cells.map((c) => `<${tag} align="center">${c}</${tag}>`).join("")}</tr>`;

/**
 * Every cell centred. One row per line, so a message reads as its table in a
 * test or a log.
 */
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

/**
 * The draw's own numbers, with the ones the tickets hold in bold. Each row's
 * numbers are one <code>, so one tap copies them all.
 */
function drawTable(draw: TotoDrawResponse | FourDDrawResponse, tickets: Ticket[]): string {
  const holds = held(tickets);
  const code = (...values: (number | string)[]): string =>
    `<code>${values.map((v) => mark(holds, v)).join(" ")}</code>`;
  const caption =
    `<b>${GAME_NAME[draw.game]} Draw #${draw.drawNo}</b> · ${displayDate(draw.drawDate)}`;
  const rows =
    draw.game === "toto"
      ? [
          ["Winning", code(...draw.numbers)],
          ["Additional", code(draw.additional)],
        ]
      : [
          ["1st", code(draw.first)],
          ["2nd", code(draw.second)],
          ["3rd", code(draw.third)],
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
 * `date` is null when only a draw number is known; `status` is null when the
 * context already says it.
 */
const pendingTable = (
  game: Game,
  date: string | null,
  status: string | null,
  tickets: Ticket[],
): string =>
  table(
    [`<b>${GAME_NAME[game]}</b>`, ...(date ? [displayDate(date)] : []), ...(status ? [status] : [])]
      .join(" · "),
    ["Ticket"],
    tickets.length > 0 ? tickets.map((t) => [ticketCode(t)]) : [["No tickets saved"]],
  );

const verdict = (won: boolean): string =>
  para(won ? "🎉 <b>You can retire!!!</b>" : "😔 <b>You cannot retire yet.</b>");

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

// --- /retire ---------------------------------------------------------------

/** Under "Upcoming draws", a draw still to come needs no status. */
const pendingBlock = (d: PendingDraw): string =>
  pendingTable(d.game, d.date, d.notDrawn ? null : "results not published yet", d.tickets);

/** The draw always; its ticket table only when tickets were saved for it. */
const latestBlock = ({ draw, checked }: LatestDraw): string =>
  [
    drawTable(draw, checked.map((c) => c.ticket)),
    ...(checked.length > 0 ? [ticketTable(checked)] : []),
  ].join("\n");

/**
 * The /retire answer, as three messages: the verdict with the newest stored
 * draw of each game and its tickets, then the draws to come with theirs, then
 * what to send next. Only the latest draws decide the verdict; a draw without
 * stored results is never counted as a loss.
 */
export function overviewMessages({ pending, latest }: Overview): [string, string, string] {
  const won = latest.some((d) => d.checked.some((c) => isWin(c.outcome)));
  const empty = [...pending.map((d) => d.tickets), ...latest.map((d) => d.checked)].every(
    (t) => t.length === 0,
  );
  return [
    [
      verdict(won),
      ...latest.map(latestBlock),
    ].join("\n"),
    [para("📅 <b>Upcoming draws</b>"), ...pending.map(pendingBlock)].join("\n"),
    (empty
      ? [para("Send your numbers to check them."), ...FORMAT_RULE.split("\n").map(para)]
      : [para("Send numbers to add another ticket.")]
    ).join("\n"),
  ];
}
