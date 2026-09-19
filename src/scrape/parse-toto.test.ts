import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseToto } from "./parse-toto.js";

const draw = parseToto(readFileSync("testdata/toto/4099.html", "utf8"));

test("parses draw 4099", () => {
  assert.equal(draw.drawNo, 4099);
  assert.equal(draw.drawDate, "2025-07-28");
  assert.deepEqual(draw.numbers, [2, 14, 16, 21, 36, 47]);
  assert.equal(draw.additional, 1);
  assert.equal(draw.group1PrizeCents, 585378200);
  assert.equal(draw.snowballed, true);
});

test("captures all seven prize groups", () => {
  assert.deepEqual(
    draw.prizeGroups.map((g) => g.group),
    [1, 2, 3, 4, 5, 6, 7],
  );
  // Group 1 had no winner: the page shows '-', which is a legitimate NULL.
  assert.equal(draw.prizeGroups[0]?.shareCents, null);
});
