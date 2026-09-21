// pnpm run backfill -- --game toto --since 2025-09-16
//
// The whole algorithm: fetch the draw list, filter it by date, fetch what
// comes back. Nothing walks backwards and nothing probes for a stopping
// condition, because the site publishes the list of valid draw numbers
// itself (see PLAN.md section 3.1).

import { parseArgs } from "node:util";
import { archive, fetchPage } from "../scrape/fetch.js";
import {
  findGaps,
  parseDrawList,
  type DrawListEntry,
} from "../scrape/draw-list.js";
import { parse4d } from "../scrape/parse-4d.js";
import { parseToto } from "../scrape/parse-toto.js";
import { contentHash } from "../scrape/hash.js";
import { drawListUrl, drawUrl, type Game } from "../scrape/url.js";
import {
  finishRun,
  insertFourdIfAbsent,
  insertTotoIfAbsent,
  startRun,
  storedDrawNos,
  type WriteMeta,
} from "../db/queries.js";
import { reportRun } from "../notify/report.js";

// --- arguments -------------------------------------------------------------

// pnpm forwards the `--` separator to the script rather than eating it, and
// parseArgs treats everything after one as positional. Drop it.
const argv = process.argv.slice(2);
const { values } = parseArgs({
  args: argv[0] === "--" ? argv.slice(1) : argv,
  options: {
    game: { type: "string", multiple: true },
    since: { type: "string" },
    until: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

/** One year back from today, the window section 1 of the plan scopes to. */
function oneYearAgo(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

function isoOrDie(value: string, flag: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(
      `--${flag} must be YYYY-MM-DD, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

const games: Game[] = (values.game ?? ["toto", "4d"]).map((g) => {
  if (g !== "toto" && g !== "4d")
    throw new Error(`--game must be toto or 4d, got ${g}`);
  return g;
});
const since = isoOrDie(values.since ?? oneYearAgo(), "since");
// Dates sort as strings, so an open upper bound is just a date nothing exceeds.
const until = values.until ? isoOrDie(values.until, "until") : "9999-12-31";
const dryRun = values["dry-run"];

// --- the job ---------------------------------------------------------------

async function planGame(game: Game): Promise<DrawListEntry[]> {
  const entries = parseDrawList(await fetchPage(drawListUrl(game)));

  // Contiguity is an assumption this project leans on elsewhere (phase 5 falls
  // back to last + 1), so check it — but only report. The backfill enumerates
  // the list itself and does not care whether the list has holes.
  const gaps = findGaps(entries);
  if (gaps.length > 0) {
    console.warn(
      `  ! ${game}: draw list has ${gaps.length} gap(s): ${gaps.join(", ")}`,
    );
  }

  const inWindow = entries.filter(
    (e) => e.drawDate >= since && e.drawDate <= until,
  );
  const cancelled = inWindow.filter((e) => e.cancelled);
  if (cancelled.length > 0) {
    // A cancelled draw has no results block to parse; skipping is the whole
    // handling it needs.
    console.log(
      `  - skipping ${cancelled.length} cancelled: ${cancelled.map((e) => e.drawNo).join(", ")}`,
    );
  }

  const stored = storedDrawNos(game);
  const wanted = inWindow.filter((e) => !e.cancelled);
  const todo = wanted
    .filter((e) => !stored.has(e.drawNo))
    // Oldest first, so an interrupted run leaves a contiguous prefix of
    // history rather than a scattering.
    .reverse();

  const oldest = entries.at(-1);
  console.log(
    `${game}: list holds ${entries.length} draws back to ${oldest?.drawDate}; ` +
      `${inWindow.length} in window; ${wanted.length - todo.length} already stored; ` +
      `${todo.length} to fetch (~${Math.ceil((todo.length * 2) / 60)} min at 0.5 req/s)`,
  );
  return todo;
}

/** Draw numbers the site lists as cascade draws. TOTO only, fetched once. */
async function cascadeDrawNos(): Promise<Set<number>> {
  const entries = parseDrawList(await fetchPage(drawListUrl("toto-cascade")));
  return new Set(entries.map((e) => e.drawNo));
}

/**
 * The site quietly serves its latest draw when it does not recognise an sppl,
 * so what came back must be what was asked for. Checking the date too makes
 * the draw list a second, independent source for it.
 */
function assertMatchesDrawList(
  draw: { drawNo: number; drawDate: string },
  entry: DrawListEntry,
): void {
  if (draw.drawNo !== entry.drawNo)
    throw new Error(`page returned draw ${draw.drawNo}`);
  if (draw.drawDate !== entry.drawDate) {
    throw new Error(`page says ${draw.drawDate}, list says ${entry.drawDate}`);
  }
}

/** Parse and store one page. Returns false if the draw was already stored. */
function store(
  game: Game,
  entry: DrawListEntry,
  html: string,
  rawPath: string,
  cascades: Set<number>,
): boolean {
  if (game === "toto") {
    const draw = parseToto(html);
    assertMatchesDrawList(draw, entry);
    const meta: WriteMeta = {
      rawPath,
      contentHash: contentHash(draw),
      // Nothing in the results markup says a draw was a cascade draw; the flag
      // comes from membership in the cascade list.
      cascadeDraw: cascades.has(entry.drawNo),
    };
    return insertTotoIfAbsent(draw, meta) !== undefined;
  }

  const draw = parse4d(html);
  assertMatchesDrawList(draw, entry);
  return (
    insertFourdIfAbsent(draw, { rawPath, contentHash: contentHash(draw) }) !==
    undefined
  );
}

async function backfill(game: Game, todo: DrawListEntry[]): Promise<void> {
  const runId = startRun("backfill", game);
  const cascades = game === "toto" ? await cascadeDrawNos() : new Set<number>();
  let fetched = 0;
  let written = 0;
  const failures: string[] = [];

  for (const [i, entry] of todo.entries()) {
    const label = `${game} ${entry.drawNo} (${entry.drawDate})`;
    try {
      const html = await fetchPage(drawUrl(game, entry.drawNo));
      fetched++;
      const rawPath = await archive(game, entry.drawNo, html);

      const wrote = store(game, entry, html, rawPath, cascades);
      if (wrote) written++;
      console.log(
        `  [${i + 1}/${todo.length}] ${label} ${wrote ? "ok" : "already stored"}`,
      );
    } catch (err) {
      // 260 requests is too many to throw the whole run away over one bad
      // page. Collect and report; the raw HTML is on disk either way.
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`${label}: ${message}`);
      console.error(`  [${i + 1}/${todo.length}] ${label} FAILED — ${message}`);
    }
  }

  const run = finishRun(runId, {
    status: failures.length > 0 ? "error" : "ok",
    pagesFetched: fetched,
    drawsWritten: written,
    error: failures.length > 0 ? failures.join("\n") : undefined,
  });
  // Counts and failures only: a backfill writes hundreds of draws, and
  // hundreds of draw lines is not a notification.
  await reportRun(run);

  console.log(
    `${game}: fetched ${fetched}, wrote ${written}, failed ${failures.length}`,
  );
  if (failures.length > 0) process.exitCode = 1;
}

const plans = new Map<Game, DrawListEntry[]>();
for (const game of games) plans.set(game, await planGame(game));

if (dryRun) {
  console.log("--dry-run: nothing fetched beyond the draw lists");
} else {
  for (const [game, todo] of plans) {
    if (todo.length > 0) await backfill(game, todo);
  }
}
