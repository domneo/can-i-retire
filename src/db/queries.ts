// Statements and the two write paths: a replacing upsert for the scrape and
// phase 5's reconciliation, and an insert-if-absent for the backfill.
//
// Every write goes through a transaction: a draw with half its prize groups
// stored is worse than no draw at all.
//
// The database may be on the other side of a network, so statements are
// batched wherever the next one does not depend on the last: a draw write is
// one round trip for the draws row and one for all of its children.

import type { InStatement, ResultSet, Transaction } from "@libsql/client";
import { db } from "./client.js";
import type { Game } from "../scrape/url.js";
import type { TotoDraw } from "../scrape/parse-toto.js";
import type { FourDDraw } from "../scrape/parse-4d.js";
import type { TotoDrawResponse, FourDDrawResponse } from "../schema/draw.js";

/** What the scraper knows about a draw beyond what the page itself says. */
export interface WriteMeta {
  /** Where the archived page lives: a local path or a Blob URL. */
  rawPath: string;
  contentHash: string;
  /** TOTO only; sourced from the cascade draw list, not from the page. */
  cascadeDraw?: boolean;
}

/** Rows typed by the caller. The client returns them untyped. */
const rows = <T>(rs: ResultSet | undefined): T[] =>
  (rs?.rows ?? []) as unknown as T[];

/** Run `fn` in a write transaction; commit if it returns, roll back if not. */
async function inTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const tx = await db.transaction("write");
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
}

// --- writes ----------------------------------------------------------------

// UPDATE rather than DELETE + re-INSERT on conflict: letting the FK cascade
// clear the children would also change draws.id, and anything holding a
// reference to it would not thank us.
const UPSERT_DRAW = `
  INSERT INTO draws (game, draw_no, draw_date, raw_path, content_hash)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (game, draw_no) DO UPDATE SET
    draw_date    = excluded.draw_date,
    raw_path     = excluded.raw_path,
    content_hash = excluded.content_hash,
    scraped_at   = datetime('now')
  RETURNING id
`;

// The backfill's write path, and deliberately not the one above. Phase 5's
// reconciliation exists to pick up prize tables corrected after publication,
// so it needs the replacing upsert; a backfill re-run must never touch a draw
// it already stored. DO NOTHING means RETURNING yields no row on conflict,
// which is exactly the "already there" signal.
const INSERT_DRAW_IF_ABSENT = `
  INSERT INTO draws (game, draw_no, draw_date, raw_path, content_hash)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (game, draw_no) DO NOTHING
  RETURNING id
`;

const drawArgs = (
  game: Game,
  draw: { drawNo: number; drawDate: string },
  meta: WriteMeta,
) => [game, draw.drawNo, draw.drawDate, meta.rawPath, meta.contentHash];

const TOTO_TABLES = [
  "toto_results",
  "toto_numbers",
  "toto_prize_groups",
  "toto_winning_outlets",
];
const FOURD_TABLES = ["fourd_results", "fourd_prizes"];

const deleteChildren = (tables: string[], id: number): InStatement[] =>
  tables.map((t) => ({ sql: `DELETE FROM ${t} WHERE draw_id = ?`, args: [id] }));

// The typed rows for one draw. Shared by both write paths; only the draws-row
// statement differs between replacing and insert-if-absent.
function totoChildren(id: number, draw: TotoDraw, meta: WriteMeta): InStatement[] {
  return [
    {
      sql: `INSERT INTO toto_results
              (draw_id, additional_number, group1_prize_cents, snowballed, cascade_draw)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        id,
        draw.additional,
        draw.group1PrizeCents,
        draw.snowballed ? 1 : 0,
        meta.cascadeDraw ? 1 : 0,
      ],
    },
    ...draw.numbers.map((n, i) => ({
      sql: "INSERT INTO toto_numbers (draw_id, position, number) VALUES (?, ?, ?)",
      args: [id, i + 1, n],
    })),
    ...draw.prizeGroups.map((g) => ({
      sql: `INSERT INTO toto_prize_groups (draw_id, prize_group, share_cents, winner_count)
            VALUES (?, ?, ?, ?)`,
      args: [id, g.group, g.shareCents, g.winners],
    })),
    ...draw.outlets.map((o) => ({
      sql: `INSERT INTO toto_winning_outlets
              (draw_id, prize_group, outlet_name, outlet_addr, entry_desc)
            VALUES (?, ?, ?, ?, ?)`,
      args: [id, o.group, o.name, o.address, o.entry],
    })),
  ];
}

function fourdChildren(id: number, draw: FourDDraw): InStatement[] {
  const prize = (category: string) => (n: string, i: number) => ({
    sql: "INSERT INTO fourd_prizes (draw_id, category, position, number) VALUES (?, ?, ?, ?)",
    args: [id, category, i + 1, n],
  });
  return [
    {
      sql: "INSERT INTO fourd_results (draw_id, first, second, third) VALUES (?, ?, ?, ?)",
      args: [id, draw.first, draw.second, draw.third],
    },
    ...draw.starter.map(prize("starter")),
    ...draw.consolation.map(prize("consolation")),
  ];
}

/** The draws.id the statement returned, or undefined if it returned no row. */
async function returnedId(
  tx: Transaction,
  sql: string,
  args: ReturnType<typeof drawArgs>,
): Promise<number | undefined> {
  return rows<{ id: number }>(await tx.execute({ sql, args }))[0]?.id;
}

export const writeToto = (draw: TotoDraw, meta: WriteMeta): Promise<number> =>
  inTransaction(async (tx) => {
    const id = (await returnedId(tx, UPSERT_DRAW, drawArgs("toto", draw, meta)))!;
    await tx.batch([
      ...deleteChildren(TOTO_TABLES, id),
      ...totoChildren(id, draw, meta),
    ]);
    return id;
  });

export const writeFourd = (draw: FourDDraw, meta: WriteMeta): Promise<number> =>
  inTransaction(async (tx) => {
    const id = (await returnedId(tx, UPSERT_DRAW, drawArgs("4d", draw, meta)))!;
    await tx.batch([...deleteChildren(FOURD_TABLES, id), ...fourdChildren(id, draw)]);
    return id;
  });

// --- backfill writes -------------------------------------------------------

/** Returns the new draws.id, or undefined if the draw was already stored. */
export const insertTotoIfAbsent = (
  draw: TotoDraw,
  meta: WriteMeta,
): Promise<number | undefined> =>
  inTransaction(async (tx) => {
    const id = await returnedId(tx, INSERT_DRAW_IF_ABSENT, drawArgs("toto", draw, meta));
    if (id !== undefined) await tx.batch(totoChildren(id, draw, meta));
    return id;
  });

/** Returns the new draws.id, or undefined if the draw was already stored. */
export const insertFourdIfAbsent = (
  draw: FourDDraw,
  meta: WriteMeta,
): Promise<number | undefined> =>
  inTransaction(async (tx) => {
    const id = await returnedId(tx, INSERT_DRAW_IF_ABSENT, drawArgs("4d", draw, meta));
    if (id !== undefined) await tx.batch(fourdChildren(id, draw));
    return id;
  });

/** Draw numbers already stored for a game. */
export async function storedDrawNos(game: Game): Promise<Set<number>> {
  const rs = await db.execute({
    sql: "SELECT draw_no FROM draws WHERE game = ?",
    args: [game],
  });
  return new Set(rows<{ draw_no: number }>(rs).map((r) => r.draw_no));
}

// --- run bookkeeping -------------------------------------------------------

/** Everything a scrape report needs, read back from the row the run wrote. */
export interface RunRow {
  id: number;
  kind: string;
  game: Game;
  status: "running" | "ok" | "error";
  pages_fetched: number;
  draws_written: number;
  /** Failure lines joined by newlines, as the job collected them. */
  error: string | null;
  /** Wall-clock seconds, or null while the run has no finished_at yet. */
  duration_seconds: number | null;
}

// started_at and finished_at are second-granularity `datetime('now')` text, so
// the duration is computed in SQL rather than kept on a timer in the job: one
// source of truth, and it survives a report sent from anywhere but the run.
const RUN_ROW = `
  SELECT id, kind, game, status, pages_fetched, draws_written, error,
         CAST(ROUND((julianday(finished_at) - julianday(started_at)) * 86400)
              AS INTEGER) AS duration_seconds
  FROM scrape_runs WHERE id = ?
`;

export async function startRun(kind: string, game: Game): Promise<number> {
  const rs = await db.execute({
    sql: "INSERT INTO scrape_runs (kind, game, status) VALUES (?, ?, 'running') RETURNING id",
    args: [kind, game],
  });
  return rows<{ id: number }>(rs)[0]!.id;
}

/** Closes the run and returns the stored row, ready to report on. */
export async function finishRun(
  id: number,
  r: {
    status: "ok" | "error";
    pagesFetched: number;
    drawsWritten: number;
    error?: string;
  },
): Promise<RunRow> {
  const [, read] = await db.batch(
    [
      {
        sql: `UPDATE scrape_runs SET
                finished_at   = datetime('now'),
                status        = ?,
                pages_fetched = ?,
                draws_written = ?,
                error         = ?
              WHERE id = ?`,
        args: [r.status, r.pagesFetched, r.drawsWritten, r.error ?? null, id],
      },
      { sql: RUN_ROW, args: [id] },
    ],
    "write",
  );
  return rows<RunRow>(read)[0]!;
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
async function latestRow(game: Game): Promise<DrawRow | undefined> {
  const rs = await db.execute({
    sql: `SELECT id, draw_no, draw_date, scraped_at FROM draws
          WHERE game = ? ORDER BY draw_no DESC LIMIT 1`,
    args: [game],
  });
  return rows<DrawRow>(rs)[0];
}

async function rowByNo(game: Game, drawNo: number): Promise<DrawRow | undefined> {
  const rs = await db.execute({
    sql: `SELECT id, draw_no, draw_date, scraped_at FROM draws
          WHERE game = ? AND draw_no = ?`,
    args: [game, drawNo],
  });
  return rows<DrawRow>(rs)[0];
}

async function hydrateToto(row: DrawRow): Promise<TotoDrawResponse> {
  const [result, numbers, prizes, outlets] = await db.batch(
    [
      { sql: "SELECT * FROM toto_results WHERE draw_id = ?", args: [row.id] },
      {
        sql: "SELECT number FROM toto_numbers WHERE draw_id = ? ORDER BY position",
        args: [row.id],
      },
      {
        sql: `SELECT prize_group, share_cents, winner_count FROM toto_prize_groups
              WHERE draw_id = ? ORDER BY prize_group`,
        args: [row.id],
      },
      {
        sql: `SELECT prize_group, outlet_name, outlet_addr, entry_desc
              FROM toto_winning_outlets WHERE draw_id = ? ORDER BY id`,
        args: [row.id],
      },
    ],
    "read",
  );
  const r = rows<{
    additional_number: number;
    group1_prize_cents: number | null;
    snowballed: number;
    cascade_draw: number;
  }>(result)[0]!;
  return {
    game: "toto",
    drawNo: row.draw_no,
    drawDate: row.draw_date,
    numbers: rows<{ number: number }>(numbers).map((n) => n.number),
    additional: r.additional_number,
    group1PrizeCents: r.group1_prize_cents,
    snowballed: r.snowballed === 1,
    cascadeDraw: r.cascade_draw === 1,
    prizeGroups: rows<{
      prize_group: number;
      share_cents: number | null;
      winner_count: number | null;
    }>(prizes).map((p) => ({
      group: p.prize_group,
      shareCents: p.share_cents,
      winners: p.winner_count,
    })),
    outlets: rows<{
      prize_group: number;
      outlet_name: string;
      outlet_addr: string | null;
      entry_desc: string | null;
    }>(outlets).map((o) => ({
      group: o.prize_group,
      name: o.outlet_name,
      address: o.outlet_addr,
      entry: o.entry_desc,
    })),
    scrapedAt: row.scraped_at,
  };
}

async function hydrateFourd(row: DrawRow): Promise<FourDDrawResponse> {
  const [result, prizeRs] = await db.batch(
    [
      { sql: "SELECT * FROM fourd_results WHERE draw_id = ?", args: [row.id] },
      {
        sql: `SELECT category, number FROM fourd_prizes
              WHERE draw_id = ? ORDER BY category, position`,
        args: [row.id],
      },
    ],
    "read",
  );
  const r = rows<{ first: string; second: string; third: string }>(result)[0]!;
  const prizes = rows<{ category: string; number: string }>(prizeRs);
  return {
    game: "4d",
    drawNo: row.draw_no,
    drawDate: row.draw_date,
    first: r.first,
    second: r.second,
    third: r.third,
    starter: prizes.filter((p) => p.category === "starter").map((p) => p.number),
    consolation: prizes
      .filter((p) => p.category === "consolation")
      .map((p) => p.number),
    scrapedAt: row.scraped_at,
  };
}

export async function latestToto(): Promise<TotoDrawResponse | undefined> {
  const row = await latestRow("toto");
  return row && hydrateToto(row);
}

export async function totoByDrawNo(
  drawNo: number,
): Promise<TotoDrawResponse | undefined> {
  const row = await rowByNo("toto", drawNo);
  return row && hydrateToto(row);
}

export async function latestFourd(): Promise<FourDDrawResponse | undefined> {
  const row = await latestRow("4d");
  return row && hydrateFourd(row);
}

export async function fourdByDrawNo(
  drawNo: number,
): Promise<FourDDrawResponse | undefined> {
  const row = await rowByNo("4d", drawNo);
  return row && hydrateFourd(row);
}
