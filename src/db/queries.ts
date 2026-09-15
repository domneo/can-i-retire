import { db } from "./client.js";
import type { TotoDraw } from "../scrape/parse-toto.js";

/** One row of `draws`, as stored. */
export interface DrawRow {
  draw_no: number;
  draw_date: string;
  numbers: string;
  additional: number;
}

/** A `draws` row with `numbers` decoded back into an array. */
export interface Draw {
  drawNo: number;
  drawDate: string;
  numbers: number[];
  additional: number;
}

const upsertStmt = db.prepare(`
  INSERT INTO draws (draw_no, draw_date, numbers, additional)
  VALUES (@draw_no, @draw_date, @numbers, @additional)
  ON CONFLICT(draw_no) DO UPDATE SET
    draw_date  = excluded.draw_date,
    numbers    = excluded.numbers,
    additional = excluded.additional
`);

const latestStmt = db.prepare(
  "SELECT * FROM draws ORDER BY draw_no DESC LIMIT 1",
);

const hydrate = (row: DrawRow): Draw => ({
  drawNo: row.draw_no,
  drawDate: row.draw_date,
  numbers: JSON.parse(row.numbers) as number[],
  additional: row.additional,
});

export function upsertDraw(draw: TotoDraw): void {
  upsertStmt.run({
    draw_no: draw.drawNo,
    draw_date: draw.drawDate,
    numbers: JSON.stringify(draw.numbers),
    additional: draw.additional,
  });
}

export function latestDraw(): Draw | undefined {
  const row = latestStmt.get() as DrawRow | undefined;
  return row && hydrate(row);
}
