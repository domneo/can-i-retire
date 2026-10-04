import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { FourDDrawResponse, TotoDrawResponse } from "../schema/draw.js";
import { evaluateFourd, evaluateToto, totoGroup, type FourDPrize } from "./evaluate.js";

const toto: TotoDrawResponse = {
  game: "toto",
  drawNo: 4217,
  drawDate: "2026-09-14",
  numbers: [6, 7, 8, 16, 18, 35],
  additional: 31,
  group1PrizeCents: 310605500,
  snowballed: false,
  cascadeDraw: false,
  prizeGroups: [
    { group: 1, shareCents: 155302700, winners: 2 },
    { group: 2, shareCents: 9000000, winners: 5 },
    { group: 3, shareCents: 150000, winners: 100 },
    { group: 4, shareCents: 40000, winners: 300 },
    { group: 5, shareCents: 5000, winners: 5000 },
    { group: 6, shareCents: 2500, winners: 7000 },
    { group: 7, shareCents: 1000, winners: 90000 },
  ],
  outlets: [],
  scrapedAt: "2026-09-15 03:41:10",
};

test("prize groups follow the published table", () => {
  assert.equal(totoGroup(6, false), 1);
  assert.equal(totoGroup(5, true), 2);
  assert.equal(totoGroup(5, false), 3);
  assert.equal(totoGroup(4, true), 4);
  assert.equal(totoGroup(4, false), 5);
  assert.equal(totoGroup(3, true), 6);
  assert.equal(totoGroup(3, false), 7);
  assert.equal(totoGroup(2, true), null);
});

test("an ordinary entry wins at most one share", () => {
  const o = evaluateToto([6, 7, 8, 16, 18, 31], toto);
  assert.deepEqual(o.wins, [{ group: 2, shares: 1, shareCents: 9000000 }]);
  assert.equal(o.matched, 5);
  assert.equal(o.additionalMatched, true);
  assert.equal(o.totalCents, 9000000);
});

test("a loss has no wins", () => {
  const o = evaluateToto([1, 2, 3, 4, 6, 7], toto);
  assert.deepEqual(o.wins, []);
  assert.equal(o.matched, 2);
  assert.equal(o.totalCents, 0);
});

test("a System 7 entry wins in every one of its seven combinations", () => {
  // All six winning numbers plus the additional: one combination is Group 1,
  // the six that swap a winning number for the additional are Group 2.
  const o = evaluateToto([6, 7, 8, 16, 18, 31, 35], toto);
  assert.deepEqual(o.wins, [
    { group: 1, shares: 1, shareCents: 155302700 },
    { group: 2, shares: 6, shareCents: 9000000 },
  ]);
  assert.equal(o.totalCents, 155302700 + 6 * 9000000);
});

test("an unpublished share amount makes the total unknown, not zero", () => {
  const snowball = {
    ...toto,
    prizeGroups: [{ group: 1, shareCents: null, winners: 0 }],
  };
  const o = evaluateToto([6, 7, 8, 16, 18, 35], snowball);
  assert.deepEqual(o.wins, [{ group: 1, shares: 1, shareCents: null }]);
  assert.equal(o.totalCents, null);
});

const fourd: FourDDrawResponse = {
  game: "4d",
  drawNo: 5535,
  drawDate: "2026-09-13",
  first: "8608",
  second: "4918",
  third: "9832",
  starter: ["0427", "1111"],
  consolation: ["0217", "2222"],
  scrapedAt: "2026-09-15 03:12:44",
};

const schedule: FourDPrize[] = [
  { tier: "1st", bigCents: 200000, smallCents: 300000 },
  { tier: "starter", bigCents: 25000, smallCents: null },
];

test("4D matches each prize category, leading zeros significant", () => {
  assert.deepEqual(evaluateFourd("8608", fourd, schedule).wins, [
    { tier: "1st", prize: schedule[0] },
  ]);
  assert.deepEqual(evaluateFourd("0427", fourd, schedule).wins, [
    { tier: "starter", prize: schedule[1] },
  ]);
  assert.deepEqual(evaluateFourd("427", fourd, schedule).wins, []);
  assert.deepEqual(evaluateFourd("0217", fourd, schedule).wins, [
    { tier: "consolation", prize: null },
  ]);
});
