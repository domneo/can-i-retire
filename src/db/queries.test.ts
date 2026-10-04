// The backfill write path's defining property: re-running must not touch a
// draw that is already stored, where the scrape path replaces it.
//
// Each node:test file runs in its own process, so pointing the connection at
// an in-memory database here cannot leak into another test, into data/, or
// into a Turso database named in the shell's environment.

process.env.TURSO_DATABASE_URL = ":memory:";
delete process.env.TURSO_AUTH_TOKEN;

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { TotoDraw } from "../scrape/parse-toto.js";

// Dynamic, because client.ts opens the database at import time and the env
// var above has to be set first.
const { db } = await import("./client.js");
const { migrate } = await import("./migrate.js");
const { insertTotoIfAbsent, storedDrawNos, totoByDrawNo, writeToto } =
  await import("./queries.js");

await migrate(db);

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

test("insert-if-absent writes a new draw and skips one already stored", async () => {
  assert.equal(typeof (await insertTotoIfAbsent(draw(), meta)), "number");
  assert.equal(await insertTotoIfAbsent(draw({ additional: 9 }), meta), undefined);

  // The second call left the first call's data alone — that is the whole
  // point of DO NOTHING here.
  assert.equal((await totoByDrawNo(4099))?.additional, 1);
  assert.deepEqual(await storedDrawNos("toto"), new Set([4099]));
});

test("the scrape path replaces where the backfill path skips", async () => {
  const id = await writeToto(draw({ drawNo: 4100 }), meta);
  assert.equal(
    await writeToto(draw({ drawNo: 4100, additional: 9 }), meta),
    id,
    "draws.id is stable",
  );
  const stored = await totoByDrawNo(4100);
  assert.equal(stored?.additional, 9);
  // Replaced, not appended to: the children were cleared before the rewrite.
  assert.deepEqual(stored?.numbers, [2, 14, 16, 21, 36, 47]);
  assert.equal(stored?.prizeGroups.length, 1);
});

test("a failed write leaves nothing behind", async () => {
  // Position 7 breaks the toto_numbers CHECK after the draws row is in.
  await assert.rejects(
    writeToto(draw({ drawNo: 4101, numbers: [1, 2, 3, 4, 5, 6, 7] }), meta),
  );
  assert.equal(await totoByDrawNo(4101), undefined);
});
