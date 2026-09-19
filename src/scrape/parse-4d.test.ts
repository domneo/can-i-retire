import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse4d } from "./parse-4d.js";
import { NoSuchDrawError } from "./errors.js";

const html = readFileSync("testdata/4d/5017.html", "utf8");

test("parses draw 5017", () => {
  const draw = parse4d(html);
  assert.equal(draw.drawNo, 5017);
  assert.equal(draw.drawDate, "2023-05-24");
  assert.equal(draw.first, "8608");
  assert.equal(draw.second, "4918");
  assert.equal(draw.third, "9832");
  assert.equal(draw.starter.length, 10);
  assert.equal(draw.consolation.length, 10);
  // Leading zeros survive only because these stay strings.
  assert.ok(draw.starter.includes("0427"));
  assert.ok(draw.consolation.includes("0217"));
});

test("treats an empty results block as a miss", () => {
  assert.throws(
    () => parse4d('<div class="divSingleDraw"></div>'),
    NoSuchDrawError,
  );
});
