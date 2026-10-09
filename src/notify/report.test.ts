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
    [
      "<p>✅ <b>TOTO manual — ok</b></p>",
      "<table bordered compact>" +
        "<tr><th>Draws written</th><td>1</td></tr>" +
        "<tr><th>Pages</th><td>3</td></tr>" +
        "<tr><th>Time</th><td>7s</td></tr></table>",
      "<p>TOTO 4217 · Mon 14 Sep 2026 · 2 14 16 21 36 47 (+1)</p>",
    ].join("\n"),
  );
});

test("a failed run reports the error and the draw it failed on", () => {
  const text = formatRun({
    ...OK,
    status: "error",
    draws_written: 0,
    error: "toto 4218: no draw number in \"\"",
  });
  assert.match(text, /^<p>🚨 <b>TOTO manual — FAILED<\/b><\/p>$/m);
  assert.match(text, /<th>Draws written<\/th><td>0<\/td>/);
  assert.match(text, /<th>Failures<\/th><td>1<\/td>/);
  assert.match(text, /^<p><code>toto 4218: no draw number in ""<\/code><\/p>$/m);
});

test("minutes once a run passes a minute", () => {
  assert.match(formatRun({ ...OK, duration_seconds: 671 }), /<th>Time<\/th><td>11m 11s<\/td>/);
  assert.match(formatRun({ ...OK, duration_seconds: 120 }), /<th>Time<\/th><td>2m<\/td>/);
});

test("caps the failure list rather than sending a wall of text", () => {
  const errors = Array.from({ length: 14 }, (_, i) => `4d ${5500 + i}: boom`);
  const text = formatRun({ ...OK, status: "error", error: errors.join("\n") });
  assert.equal(text.match(/<code>/g)?.length, 10);
  assert.match(text, /<p>…and 4 more<\/p>$/);
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
