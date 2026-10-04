import { strict as assert } from "node:assert";
import { test } from "node:test";
import { sgtToday, upcomingDrawDate } from "./drawdays.js";

// Sun 4 Oct 2026, 10:00 SGT.
const sunMorning = new Date("2026-10-04T02:00:00Z");

test("today is read in Singapore, not UTC", () => {
  assert.equal(sgtToday(new Date("2026-10-03T16:30:00Z")), "2026-10-04");
  assert.equal(sgtToday(new Date("2026-10-03T15:59:00Z")), "2026-10-03");
});

test("a draw day today is upcoming until its results are stored", () => {
  assert.equal(upcomingDrawDate("4d", "2026-10-03", sunMorning), "2026-10-04");
  assert.equal(upcomingDrawDate("4d", "2026-10-04", sunMorning), "2026-10-07");
});

test("TOTO's next draw is Monday or Thursday", () => {
  assert.equal(upcomingDrawDate("toto", "2026-10-01", sunMorning), "2026-10-05");
  assert.equal(upcomingDrawDate("toto", "2026-10-05", sunMorning), "2026-10-08");
});

test("with no draw stored, the next draw day from today", () => {
  assert.equal(upcomingDrawDate("toto", undefined, sunMorning), "2026-10-05");
  assert.equal(upcomingDrawDate("4d", undefined, sunMorning), "2026-10-04");
});

test("a scraper weeks behind does not make an old date upcoming", () => {
  assert.equal(upcomingDrawDate("toto", "2026-09-14", sunMorning), "2026-10-05");
});
