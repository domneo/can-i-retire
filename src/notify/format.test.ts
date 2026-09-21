import { strict as assert } from "node:assert";
import { test } from "node:test";
import { dollars, fourdLine, totoLine } from "./format.js";
import type { TotoDraw } from "../scrape/parse-toto.js";
import type { FourDDraw } from "../scrape/parse-4d.js";

const TOTO: TotoDraw = {
  drawNo: 4217,
  drawDate: "2026-09-14",
  numbers: [2, 14, 16, 21, 36, 47],
  additional: 1,
  group1PrizeCents: 585378200,
  snowballed: false,
  prizeGroups: [{ group: 1, shareCents: 585378200, winners: 1 }],
  outlets: [],
};

const FOURD: FourDDraw = {
  drawNo: 5536,
  drawDate: "2026-09-19",
  first: "0427",
  second: "5678",
  third: "9012",
  starter: [],
  consolation: [],
};

test("formats cents as dollars, with cents only when there are any", () => {
  assert.equal(dollars(585378200), "$5,853,782");
  assert.equal(dollars(585378255), "$5,853,782.55");
  assert.equal(dollars(0), "$0");
  assert.equal(dollars(null), "-");
});

test("summarises a TOTO draw", () => {
  assert.equal(
    totoLine(TOTO),
    "TOTO 4217 · Mon 14 Sep 2026 · 2 14 16 21 36 47 (+1) · Group 1 $5,853,782",
  );
});

test("flags snowballed and cascade draws", () => {
  assert.equal(
    totoLine({ ...TOTO, snowballed: true }, true).split(" · ").at(-1),
    "[snowballed, cascade]",
  );
});

test("summarises a 4D draw as its top three", () => {
  assert.equal(
    fourdLine(FOURD),
    "4D 5536 · Sat 19 Sep 2026 · 1st 0427 · 2nd 5678 · 3rd 9012",
  );
});
