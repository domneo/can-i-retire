import { strict as assert } from "node:assert";
import { test } from "node:test";
import { canonical, fromRow, parseTicket } from "./ticket.js";

test("four digits are a 4D ticket, leading zeros kept", () => {
  assert.deepEqual(parseTicket(" 0427 "), {
    kind: "ticket",
    ticket: { game: "4d", number: "0427" },
  });
});

test("6 to 12 distinct numbers in 1-49 are a TOTO ticket, sorted", () => {
  assert.deepEqual(parseTicket("47, 2 16 14,21 36"), {
    kind: "ticket",
    ticket: { game: "toto", numbers: [2, 14, 16, 21, 36, 47] },
  });
  const system12 = parseTicket("1 2 3 4 5 6 7 8 9 10 11 12");
  assert.equal(system12.kind, "ticket");
});

test("ambiguous number shapes are rejected, not guessed", () => {
  for (const text of [
    "427", //                     too short for 4D
    "0427 1234", //               two 4D numbers
    "1 2 3 4 5", //               too few for TOTO
    "1 2 3 4 5 6 7 8 9 10 11 12 13", // too many
    "1 2 3 4 5 50", //            out of range
    "0 2 3 4 5 6", //             out of range
    "1 2 3 4 5 5", //             repeated
  ]) {
    assert.equal(parseTicket(text).kind, "invalid", text);
  }
});

test("text that is not numbers is not a ticket", () => {
  assert.equal(parseTicket("hello").kind, "none");
  assert.equal(parseTicket("my numbers 1 2 3 4 5 6").kind, "none");
  assert.equal(parseTicket("   ").kind, "none");
});

test("canonical text round-trips through fromRow", () => {
  for (const text of ["0427", "2 14 16 21 36 47"]) {
    const parsed = parseTicket(text);
    assert.equal(parsed.kind, "ticket");
    if (parsed.kind !== "ticket") continue;
    const stored = canonical(parsed.ticket);
    assert.deepEqual(fromRow(parsed.ticket.game, stored), parsed.ticket);
  }
});
