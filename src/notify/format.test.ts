import { strict as assert } from "node:assert";
import { test } from "node:test";
import { dollars, fourdTable, totoTable } from "./format.js";
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

test("tabulates a TOTO draw", () => {
  assert.equal(
    totoTable(TOTO),
    "<table bordered compact><caption><b>TOTO Draw #4217</b> · Mon 14 Sep 2026</caption>" +
      "<tr><th>Winning</th><td><code>2 14 16 21 36 47</code></td></tr>" +
      "<tr><th>Additional</th><td><code>1</code></td></tr>" +
      "<tr><th>Group 1</th><td>$5,853,782</td></tr></table>",
  );
});

test("flags snowballed and cascade draws", () => {
  assert.match(
    totoTable({ ...TOTO, snowballed: true }, true),
    /<tr><th>Notes<\/th><td>Snowballed, Cascade<\/td><\/tr><\/table>$/,
  );
});

test("tabulates a 4D draw as its top three", () => {
  assert.equal(
    fourdTable(FOURD),
    "<table bordered compact><caption><b>4D Draw #5536</b> · Sat 19 Sep 2026</caption>" +
      "<tr><th>1st</th><td><code>0427</code></td></tr>" +
      "<tr><th>2nd</th><td><code>5678</code></td></tr>" +
      "<tr><th>3rd</th><td><code>9012</code></td></tr></table>",
  );
});
