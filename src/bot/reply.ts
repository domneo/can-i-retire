// What the bot says. Pure formatting over evaluated tickets, so the copy is
// testable without Telegram or a database. Messages are HTML parse_mode.

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
import { canonical, FORMAT_RULE, type Ticket } from "./ticket.js";

/** One ticket, and what checking it found. */
export type Checked =
  | { ticket: Ticket; draw: TotoDrawResponse | FourDDrawResponse; outcome: Outcome }
  /** No draw of this game is stored, so there is nothing to check against. */
  | { ticket: Ticket; draw: null };

const GAME_NAME: Record<Game, string> = { toto: "TOTO", "4d": "4D" };

export const WELCOME =
  "Send your 4D or TOTO numbers and I will check them against the latest draw. " +
  "Ask <b>Can I retire?</b> or send /retire to check every ticket you have sent.\n\n" +
  FORMAT_RULE;

export const NO_TICKETS = `Provide draw numbers.\n\n${FORMAT_RULE}`;

export const PHOTO_UNSUPPORTED =
  `Photo tickets are not supported yet. Type the numbers instead.\n\n${FORMAT_RULE}`;

export const ERROR = "Something went wrong on my side. Try again in a minute.";

export const invalidTicket = (reason: string): string => `${reason}\n\n${FORMAT_RULE}`;

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
 * The verdict, then each game's draw with its tickets under it.
 *
 * A ticket with no stored draw says so: it is never counted as a loss. That
 * is the PRD's one hard rule.
 */
export function resultsMessage(checked: Checked[]): string {
  if (checked.length === 0) return NO_TICKETS;

  const won = checked.some((c) => hasDraw(c) && isWin(c.outcome));
  const blocks: string[] = [won ? "🎉 <b>You can retire!!!</b>" : "<b>You cannot retire yet.</b>"];

  for (const game of ["toto", "4d"] as const) {
    const mine = checked.filter((c) => c.ticket.game === game);
    if (mine.length === 0) continue;
    // Every ticket of a game is checked against the same latest draw, so
    // either all of them have it or none do.
    const checkedAgainst = mine.filter(hasDraw);
    blocks.push(
      checkedAgainst.length > 0
        ? [drawHeading(checkedAgainst[0]!.draw), ...checkedAgainst.map(resultLine)].join("\n")
        : [
            `<b>${GAME_NAME[game]}</b> · results not published yet`,
            ...mine.map((c) => `• ${canonical(c.ticket)}`),
          ].join("\n"),
    );
  }
  return blocks.join("\n\n");
}

/** Reply to a newly typed ticket: what was saved, then its result. */
export function savedMessage(checked: Checked, isNew: boolean): string {
  const name = GAME_NAME[checked.ticket.game];
  const saved = isNew ? `Saved your ${name} ticket.` : `You already sent this ${name} ticket.`;
  return `${saved}\n\n${resultsMessage([checked])}`;
}
