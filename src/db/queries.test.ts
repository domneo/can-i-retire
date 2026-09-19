// The backfill write path's defining property: re-running must not touch a
// draw that is already stored, where the scrape path replaces it.
//
// Each node:test file runs in its own process, so pointing the connection at
// an in-memory database here cannot leak into another test or into data/.

process.env.SGPOOLS_DB = ":memory:";

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { TotoDraw } from "../scrape/parse-toto.js";

// Dynamic, because client.ts opens the database at import time and the env
// var above has to be set first.
const { insertTotoIfAbsent, storedDrawNos, totoByDrawNo, writeToto } =
  await import("./queries.js");

const draw = (over: Partial<TotoDraw> = {}): TotoDraw => ({
  drawNo: 4099,
  drawDate: "2025-07-28",
  numbers: [2, 14, 16, 21, 36, 47],
  additional: 1,
  group1PrizeCents: 585378200,
  snowballed: true,
  prizeGroups: [{ group: 1, shareCents: 585378200, winners: 1 }],
  outlets: [],
  ...over,
});

const meta = { rawPath: "data/raw/toto/4099.html", contentHash: "abc" };

test("insert-if-absent writes a new draw and skips one already stored", () => {
  assert.equal(typeof insertTotoIfAbsent(draw(), meta), "number");
  assert.equal(insertTotoIfAbsent(draw({ additional: 9 }), meta), undefined);

  // The second call left the first call's data alone — that is the whole
  // point of DO NOTHING here.
  assert.equal(totoByDrawNo(4099)?.additional, 1);
  assert.deepEqual(storedDrawNos("toto"), new Set([4099]));
});

test("the scrape path replaces where the backfill path skips", () => {
  const id = writeToto(draw({ drawNo: 4100 }), meta);
  assert.equal(
    writeToto(draw({ drawNo: 4100, additional: 9 }), meta),
    id,
    "draws.id is stable",
  );
  assert.equal(totoByDrawNo(4100)?.additional, 9);
});
