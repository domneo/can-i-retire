import { strict as assert } from "node:assert";
import { test } from "node:test";
import { displayDate, isoDate } from "./date.js";

test("parses the date the site prints", () => {
  assert.equal(isoDate("Mon, 28 Jul 2025"), "2025-07-28");
  assert.equal(isoDate("  Thu,  4  Sep  2025 "), "2025-09-04");
  assert.throws(() => isoDate("sometime last week"), /unparseable draw date/);
});

test("renders a draw date back, without shifting the day", () => {
  assert.equal(displayDate("2026-09-14"), "Mon 14 Sep 2026");
  // A date whose UTC midnight is the previous day in SGT, and the reverse.
  assert.equal(displayDate("2026-01-01"), "Thu 1 Jan 2026");
  assert.equal(displayDate("2025-12-31"), "Wed 31 Dec 2025");
});

test("round-trips every month name, including the one ICU calls Sept", () => {
  for (let m = 1; m <= 12; m++) {
    const iso = `2025-${String(m).padStart(2, "0")}-15`;
    assert.equal(isoDate(displayDate(iso)), iso);
  }
});
