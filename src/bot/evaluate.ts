// Check a ticket against one stored draw. Pure: the draw and the prize
// schedule come in as arguments, so a result is the same however often it is
// asked for.
//
// Prize amounts come from the scraped tables, never from hardcoded rules:
// TOTO from the draw's own prize groups, 4D from fourd_prize_schedule.

import type { FourDDrawResponse, TotoDrawResponse } from "../schema/draw.js";

// --- TOTO ------------------------------------------------------------------

export interface TotoWin {
  group: number;
  /** Winning shares in this group: more than one only for a System entry. */
  shares: number;
  /** One share's amount, or null when the results page showed '-'. */
  shareCents: number | null;
}

export interface TotoOutcome {
  game: "toto";
  /** Of the ticket's numbers, how many are among the six winning numbers. */
  matched: number;
  additionalMatched: boolean;
  /** Best group first. Empty for a loss. */
  wins: TotoWin[];
  /** Sum over wins, or null when any won share has no published amount. */
  totalCents: number | null;
}

/** The prize group for one six-number combination, or null for no prize. */
export function totoGroup(matched: number, additional: boolean): number | null {
  if (matched === 6) return 1;
  if (matched === 5) return additional ? 2 : 3;
  if (matched === 4) return additional ? 4 : 5;
  if (matched === 3) return additional ? 6 : 7;
  return null;
}

/** Every k-element subset of `items`, in order. */
function* combinations<T>(items: T[], k: number, start = 0): Generator<T[]> {
  if (k === 0) {
    yield [];
    return;
  }
  for (let i = start; i <= items.length - k; i++) {
    for (const rest of combinations(items, k - 1, i + 1)) yield [items[i]!, ...rest];
  }
}

/**
 * A System entry of n numbers is every six-number combination of them, each
 * one an ordinary bet — System 12 is 924 of them. So it is evaluated as
 * exactly that, and a single combination's group can never be misjudged by a
 * shortcut over the whole set.
 */
export function evaluateToto(numbers: number[], draw: TotoDrawResponse): TotoOutcome {
  const winning = new Set(draw.numbers);
  const shares = new Map<number, number>();
  for (const combo of combinations(numbers, 6)) {
    const group = totoGroup(
      combo.filter((n) => winning.has(n)).length,
      combo.includes(draw.additional),
    );
    if (group !== null) shares.set(group, (shares.get(group) ?? 0) + 1);
  }

  const wins = [...shares]
    .sort(([a], [b]) => a - b)
    .map(([group, count]) => ({
      group,
      shares: count,
      shareCents:
        draw.prizeGroups.find((p) => p.group === group)?.shareCents ?? null,
    }));

  return {
    game: "toto",
    matched: numbers.filter((n) => winning.has(n)).length,
    additionalMatched: numbers.includes(draw.additional),
    wins,
    totalCents: wins.every((w) => w.shareCents !== null)
      ? wins.reduce((sum, w) => sum + w.shares * w.shareCents!, 0)
      : null,
  };
}

// --- 4D --------------------------------------------------------------------

export type FourDTier = "1st" | "2nd" | "3rd" | "starter" | "consolation";

/** One row of fourd_prize_schedule: the payout per $1 bet. */
export interface FourDPrize {
  tier: FourDTier;
  bigCents: number;
  /** null: the tier pays nothing on a Small bet. */
  smallCents: number | null;
}

export interface FourDWin {
  tier: FourDTier;
  /** null when no schedule covers the draw's date. */
  prize: FourDPrize | null;
}

export interface FourDOutcome {
  game: "4d";
  /** Highest tier first. Empty for a loss. */
  wins: FourDWin[];
}

/**
 * A straight match only: v1 does not model iBet or other permutation bets.
 * Big or Small is not asked for, so a win quotes both payouts.
 */
export function evaluateFourd(
  number: string,
  draw: FourDDrawResponse,
  schedule: FourDPrize[],
): FourDOutcome {
  const tiers: FourDTier[] = [];
  if (draw.first === number) tiers.push("1st");
  if (draw.second === number) tiers.push("2nd");
  if (draw.third === number) tiers.push("3rd");
  if (draw.starter.includes(number)) tiers.push("starter");
  if (draw.consolation.includes(number)) tiers.push("consolation");
  return {
    game: "4d",
    wins: tiers.map((tier) => ({
      tier,
      prize: schedule.find((p) => p.tier === tier) ?? null,
    })),
  };
}

export type Outcome = TotoOutcome | FourDOutcome;

export const isWin = (o: Outcome): boolean => o.wins.length > 0;
