import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseDrawList } from "./draw-list.js";

const SAMPLE = `<select class='form-control selectDrawList'>
<option queryString='sppl=RHJhd051bWJlcj00MjE3' value='4217' winningSharesUploaded='True' isCancelled=''>Mon, 14 Sep 2026</option>
<option queryString='sppl=RHJhd051bWJlcj00MjE2' value='4216' winningSharesUploaded='True' isCancelled='True'>Thu, 10 Sep 2026</option>
</select>`;

test("parses draw numbers, dates and the cancelled flag", () => {
  const entries = parseDrawList(SAMPLE);
  assert.deepEqual(entries, [
    { drawNo: 4217, drawDate: "2026-09-14", cancelled: false },
    { drawNo: 4216, drawDate: "2026-09-10", cancelled: true },
  ]);
});
