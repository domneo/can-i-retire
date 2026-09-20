// Prepared statements and the two write paths: a replacing upsert for the
// scrape and phase 5's reconciliation, and an insert-if-absent for the
// backfill.
//
// Every write goes through db.transaction(): a draw with half its prize groups
// stored is worse than no draw at all.

import { db } from "./client.js";
import type { Game } from "../scrape/url.js";
import type { TotoDraw } from "../scrape/parse-toto.js";
import type { FourDDraw } from "../scrape/parse-4d.js";
import type { TotoDrawResponse, FourDDrawResponse } from "../schema/draw.js";

/** What the scraper knows about a draw beyond what the page itself says. */
export interface WriteMeta {
  rawPath: string;
  contentHash: string;
  /** TOTO only; sourced from the cascade draw list, not from the page. */
  cascadeDraw?: boolean;
}

// --- writes ----------------------------------------------------------------

// UPDATE rather than DELETE + re-INSERT on conflict: letting the FK cascade
// clear the children would also change draws.id, and anything holding a
// reference to it would not thank us.
const upsertDraw = db.prepare(`
  INSERT INTO draws (game, draw_no, draw_date, raw_path, content_hash)
  VALUES (@game, @draw_no, @draw_date, @raw_path, @content_hash)
  ON CONFLICT (game, draw_no) DO UPDATE SET
    draw_date    = excluded.draw_date,
    raw_path     = excluded.raw_path,
    content_hash = excluded.content_hash,
    scraped_at   = datetime('now')
  RETURNING id
`);

const delToto = [
  db.prepare("DELETE FROM toto_results        WHERE draw_id = ?"),
  db.prepare("DELETE FROM toto_numbers        WHERE draw_id = ?"),
  db.prepare("DELETE FROM toto_prize_groups   WHERE draw_id = ?"),
  db.prepare("DELETE FROM toto_winning_outlets WHERE draw_id = ?"),
];

const insTotoResult = db.prepare(`
  INSERT INTO toto_results
    (draw_id, additional_number, group1_prize_cents, snowballed, cascade_draw)
  VALUES (?, ?, ?, ?, ?)
`);
const insTotoNumber = db.prepare(
  "INSERT INTO toto_numbers (draw_id, position, number) VALUES (?, ?, ?)",
);
const insTotoPrize = db.prepare(`
  INSERT INTO toto_prize_groups (draw_id, prize_group, share_cents, winner_count)
  VALUES (?, ?, ?, ?)
`);
const insTotoOutlet = db.prepare(`
  INSERT INTO toto_winning_outlets
    (draw_id, prize_group, outlet_name, outlet_addr, entry_desc)
  VALUES (?, ?, ?, ?, ?)
`);

const delFourd = [
  db.prepare("DELETE FROM fourd_results WHERE draw_id = ?"),
  db.prepare("DELETE FROM fourd_prizes  WHERE draw_id = ?"),
];

const insFourdResult = db.prepare(
  "INSERT INTO fourd_results (draw_id, first, second, third) VALUES (?, ?, ?, ?)",
);
const insFourdPrize = db.prepare(
  "INSERT INTO fourd_prizes (draw_id, category, position, number) VALUES (?, ?, ?, ?)",
);

const drawId = (
  game: Game,
  draw: { drawNo: number; drawDate: string },
  meta: WriteMeta,
) =>
  (
    upsertDraw.get({
      game,
      draw_no: draw.drawNo,
      draw_date: draw.drawDate,
      raw_path: meta.rawPath,
      content_hash: meta.contentHash,
    }) as { id: number }
  ).id;

// The typed rows for one draw. Shared by both write paths below; only the
// draws-row statement differs between replacing and insert-if-absent.
function writeTotoChildren(id: number, draw: TotoDraw, meta: WriteMeta): void {
  insTotoResult.run(
    id,
    draw.additional,
    draw.group1PrizeCents,
    draw.snowballed ? 1 : 0,
    meta.cascadeDraw ? 1 : 0,
  );
  draw.numbers.forEach((n, i) => insTotoNumber.run(id, i + 1, n));
  for (const g of draw.prizeGroups) {
    insTotoPrize.run(id, g.group, g.shareCents, g.winners);
  }
  for (const o of draw.outlets) {
    insTotoOutlet.run(id, o.group, o.name, o.address, o.entry);
  }
}

function writeFourdChildren(id: number, draw: FourDDraw): void {
  insFourdResult.run(id, draw.first, draw.second, draw.third);
  draw.starter.forEach((n, i) => insFourdPrize.run(id, "starter", i + 1, n));
  draw.consolation.forEach((n, i) =>
    insFourdPrize.run(id, "consolation", i + 1, n),
  );
}

export const writeToto = db.transaction(
  (draw: TotoDraw, meta: WriteMeta): number => {
    const id = drawId("toto", draw, meta);
    for (const stmt of delToto) stmt.run(id);
    writeTotoChildren(id, draw, meta);
    return id;
  },
);

export const writeFourd = db.transaction(
  (draw: FourDDraw, meta: WriteMeta): number => {
    const id = drawId("4d", draw, meta);
    for (const stmt of delFourd) stmt.run(id);
    writeFourdChildren(id, draw);
    return id;
  },
);

// --- backfill writes -------------------------------------------------------

// The backfill's write path, and deliberately not the one above. Phase 5's
// reconciliation exists to pick up prize tables corrected after publication,
// so it needs the replacing upsert; a backfill re-run must never touch a draw
// it already stored. DO NOTHING means RETURNING yields no row on conflict,
// which is exactly the "already there" signal.
const insertDrawIfAbsent = db.prepare(`
  INSERT INTO draws (game, draw_no, draw_date, raw_path, content_hash)
  VALUES (@game, @draw_no, @draw_date, @raw_path, @content_hash)
  ON CONFLICT (game, draw_no) DO NOTHING
  RETURNING id
`);

const newDrawId = (
  game: Game,
  draw: { drawNo: number; drawDate: string },
  meta: WriteMeta,
): number | undefined =>
  (
    insertDrawIfAbsent.get({
      game,
      draw_no: draw.drawNo,
      draw_date: draw.drawDate,
      raw_path: meta.rawPath,
      content_hash: meta.contentHash,
    }) as { id: number } | undefined
  )?.id;

/** Returns the new draws.id, or undefined if the draw was already stored. */
export const insertTotoIfAbsent = db.transaction(
  (draw: TotoDraw, meta: WriteMeta): number | undefined => {
    const id = newDrawId("toto", draw, meta);
    if (id === undefined) return undefined;
    writeTotoChildren(id, draw, meta);
    return id;
  },
);

/** Returns the new draws.id, or undefined if the draw was already stored. */
export const insertFourdIfAbsent = db.transaction(
  (draw: FourDDraw, meta: WriteMeta): number | undefined => {
    const id = newDrawId("4d", draw, meta);
    if (id === undefined) return undefined;
    writeFourdChildren(id, draw);
    return id;
  },
);

/** Draw numbers already stored for a game. */
const storedDrawNosStmt = db.prepare(
  "SELECT draw_no FROM draws WHERE game = ?",
);

export function storedDrawNos(game: Game): Set<number> {
  return new Set(
    (storedDrawNosStmt.all(game) as { draw_no: number }[]).map(
      (r) => r.draw_no,
    ),
  );
}

// --- run bookkeeping -------------------------------------------------------

const startRunStmt = db.prepare(
  "INSERT INTO scrape_runs (kind, game, status) VALUES (?, ?, 'running') RETURNING id",
);
const finishRunStmt = db.prepare(`
  UPDATE scrape_runs SET
    finished_at   = datetime('now'),
    status        = @status,
    pages_fetched = @pages_fetched,
    draws_written = @draws_written,
    error         = @error
  WHERE id = @id
`);

export const startRun = (kind: string, game: Game): number =>
  (startRunStmt.get(kind, game) as { id: number }).id;

export function finishRun(
  id: number,
  r: {
    status: "ok" | "error";
    pagesFetched: number;
    drawsWritten: number;
    error?: string;
  },
): void {
  finishRunStmt.run({
    id,
    status: r.status,
    pages_fetched: r.pagesFetched,
    draws_written: r.drawsWritten,
    error: r.error ?? null,
  });
}

// --- reads -----------------------------------------------------------------

interface DrawRow {
  id: number;
  draw_no: number;
  draw_date: string;
  scraped_at: string;
}

// Every stored draw is servable: a parse that fails never reaches the write
// path, so there is nothing to filter out here.
const latestRowStmt = db.prepare(
  `SELECT id, draw_no, draw_date, scraped_at FROM draws
   WHERE game = ? ORDER BY draw_no DESC LIMIT 1`,
);
const rowByNoStmt = db.prepare(
  `SELECT id, draw_no, draw_date, scraped_at FROM draws
   WHERE game = ? AND draw_no = ?`,
);

const latestRow = (game: Game) =>
  latestRowStmt.get(game) as DrawRow | undefined;
const rowByNo = (game: Game, drawNo: number) =>
  rowByNoStmt.get(game, drawNo) as DrawRow | undefined;

const totoResultStmt = db.prepare(
  "SELECT * FROM toto_results WHERE draw_id = ?",
);
const totoNumbersStmt = db.prepare(
  "SELECT number FROM toto_numbers WHERE draw_id = ? ORDER BY position",
);
const totoPrizesStmt = db.prepare(
  "SELECT prize_group, share_cents, winner_count FROM toto_prize_groups WHERE draw_id = ? ORDER BY prize_group",
);
const totoOutletsStmt = db.prepare(
  "SELECT prize_group, outlet_name, outlet_addr, entry_desc FROM toto_winning_outlets WHERE draw_id = ? ORDER BY id",
);

function hydrateToto(row: DrawRow): TotoDrawResponse {
  const result = totoResultStmt.get(row.id) as {
    additional_number: number;
    group1_prize_cents: number | null;
    snowballed: number;
    cascade_draw: number;
  };
  return {
    game: "toto",
    drawNo: row.draw_no,
    drawDate: row.draw_date,
    numbers: (totoNumbersStmt.all(row.id) as { number: number }[]).map(
      (r) => r.number,
    ),
    additional: result.additional_number,
    group1PrizeCents: result.group1_prize_cents,
    snowballed: result.snowballed === 1,
    cascadeDraw: result.cascade_draw === 1,
    prizeGroups: (
      totoPrizesStmt.all(row.id) as {
        prize_group: number;
        share_cents: number | null;
        winner_count: number | null;
      }[]
    ).map((r) => ({
      group: r.prize_group,
      shareCents: r.share_cents,
      winners: r.winner_count,
    })),
    outlets: (
      totoOutletsStmt.all(row.id) as {
        prize_group: number;
        outlet_name: string;
        outlet_addr: string | null;
        entry_desc: string | null;
      }[]
    ).map((r) => ({
      group: r.prize_group,
      name: r.outlet_name,
      address: r.outlet_addr,
      entry: r.entry_desc,
    })),
    scrapedAt: row.scraped_at,
  };
}

const fourdResultStmt = db.prepare(
  "SELECT * FROM fourd_results WHERE draw_id = ?",
);
const fourdPrizesStmt = db.prepare(
  "SELECT category, number FROM fourd_prizes WHERE draw_id = ? ORDER BY category, position",
);

function hydrateFourd(row: DrawRow): FourDDrawResponse {
  const result = fourdResultStmt.get(row.id) as {
    first: string;
    second: string;
    third: string;
  };
  const prizes = fourdPrizesStmt.all(row.id) as {
    category: string;
    number: string;
  }[];
  return {
    game: "4d",
    drawNo: row.draw_no,
    drawDate: row.draw_date,
    first: result.first,
    second: result.second,
    third: result.third,
    starter: prizes
      .filter((p) => p.category === "starter")
      .map((p) => p.number),
    consolation: prizes
      .filter((p) => p.category === "consolation")
      .map((p) => p.number),
    scrapedAt: row.scraped_at,
  };
}

export function latestToto(): TotoDrawResponse | undefined {
  const row = latestRow("toto");
  return row && hydrateToto(row);
}

export function totoByDrawNo(drawNo: number): TotoDrawResponse | undefined {
  const row = rowByNo("toto", drawNo);
  return row && hydrateToto(row);
}

export function latestFourd(): FourDDrawResponse | undefined {
  const row = latestRow("4d");
  return row && hydrateFourd(row);
}

export function fourdByDrawNo(drawNo: number): FourDDrawResponse | undefined {
  const row = rowByNo("4d", drawNo);
  return row && hydrateFourd(row);
}
