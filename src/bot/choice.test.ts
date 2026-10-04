import { strict as assert } from "node:assert";
import { test } from "node:test";
import { decodeChoice, encodeChoice, type Choice } from "./choice.js";

test("a choice round-trips through callback data", () => {
  const choices: Choice[] = [
    { kind: "draw", drawNo: 4217, ticket: { game: "toto", numbers: [2, 14, 16, 21, 36, 47] } },
    { kind: "upcoming", date: "2026-10-04", ticket: { game: "4d", number: "0427" } },
  ];
  for (const choice of choices) assert.deepEqual(decodeChoice(encodeChoice(choice)), choice);
});

test("the longest choice fits Telegram's 64 bytes", () => {
  const numbers = [38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49];
  const data = encodeChoice({ kind: "upcoming", date: "2026-10-08", ticket: { game: "toto", numbers } });
  assert.ok(Buffer.byteLength(data) <= 64, `${Buffer.byteLength(data)} bytes`);
});

test("data this bot did not write is rejected", () => {
  for (const data of ["", "x:1:0427", "d::0427", "d:1:427", "d:1:1 1 2 3 4 5", "u:tomorrow:0427"]) {
    assert.equal(decodeChoice(data), null, data);
  }
});
