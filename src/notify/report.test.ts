import { strict as assert } from "node:assert";
import { test } from "node:test";
import { formatRun } from "./report.js";
import { escapeHtml } from "./telegram.js";
import type { RunRow } from "../db/queries.js";

const OK: RunRow = {
  id: 1,
  kind: "manual",
  game: "toto",
  status: "ok",
  pages_fetched: 3,
  draws_written: 1,
  error: null,
  duration_seconds: 7,
};

test("a successful run reports counts and the draw", () => {
  assert.equal(
    formatRun(OK, ["TOTO 4217 · Mon 14 Sep 2026 · 2 14 16 21 36 47 (+1)"]),
    "✅ <b>TOTO manual — ok</b>\n" +
      "1 draw written · 3 pages · 7s\n" +
      "TOTO 4217 · Mon 14 Sep 2026 · 2 14 16 21 36 47 (+1)",
  );
});

test("a failed run reports the error and the draw it failed on", () => {
  const text = formatRun({
    ...OK,
    status: "error",
    draws_written: 0,
    error: "toto 4218: no draw number in \"\"",
  });
  assert.match(text, /^🚨 <b>TOTO manual — FAILED<\/b>$/m);
  assert.match(text, /0 draws written · 3 pages · 7s · 1 failure/);
  assert.match(text, /<code>toto 4218: no draw number in ""<\/code>/);
});

test("minutes once a run passes a minute", () => {
  assert.match(formatRun({ ...OK, duration_seconds: 671 }), / · 11m 11s$/m);
  assert.match(formatRun({ ...OK, duration_seconds: 120 }), / · 2m$/m);
});

test("caps the failure list rather than sending a wall of text", () => {
  const errors = Array.from({ length: 14 }, (_, i) => `4d ${5500 + i}: boom`);
  const text = formatRun({ ...OK, status: "error", error: errors.join("\n") });
  assert.equal(text.match(/<code>/g)?.length, 10);
  assert.match(text, /…and 4 more$/);
});

test("escapes HTML so a parser message cannot break the markup", () => {
  const text = formatRun({
    ...OK,
    status: "error",
    error: "toto 4218: no <div class='divSingleDraw'> & no results",
  });
  assert.match(text, /no &lt;div class='divSingleDraw'&gt; &amp; no results/);
  assert.equal(escapeHtml("a<b>c&d"), "a&lt;b&gt;c&amp;d");
});
