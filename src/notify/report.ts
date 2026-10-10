// One Telegram message per scrape run, built entirely from the scrape_runs
// row so the chat and the database can never disagree about what happened.
//
// The failure message is the one that matters. A parser broken by a site
// redesign produces no draws, and no draws is exactly what a quiet week looks
// like — only an explicit alert tells the two apart.

import type { RunRow } from "../db/queries.js";
import type { Game } from "../scrape/url.js";
import { escapeHtml, sendTelegram } from "./telegram.js";

const GAME_LABEL: Record<Game, string> = { toto: "TOTO", "4d": "4D" };

/** Enough to diagnose; the rest is in `scrape_runs.error` and the logs. */
const MAX_FAILURE_LINES = 10;

function duration(seconds: number | null): string {
  if (seconds === null) return "unfinished";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/**
 * Build the message for a finished run, as rich HTML: the counts are a table.
 * `draws` are rich HTML tables from ./format.js, one line each — a per-draw
 * run passes what it wrote, a backfill passes nothing rather than three
 * hundred tables.
 *
 * A successful scheduled run is just its draws: it arrives on a timetable, so
 * the header and counts say nothing the draw does not. A failure keeps them,
 * because the header is what makes it read as an alert.
 *
 * One block per line, so ./telegram.js can cut an over-long message at a
 * newline without leaving a tag open.
 */
export function formatRun(run: RunRow, draws: string[] = []): string {
  const ok = run.status === "ok";
  // The row stores the failures the job collected, one per line.
  const failures = run.error ? run.error.split("\n") : [];

  const counts: [string, string][] = [
    ["Draws written", String(run.draws_written)],
    ["Pages", String(run.pages_fetched)],
    ["Time", duration(run.duration_seconds)],
    ...(failures.length > 0 ? [["Failures", String(failures.length)] as [string, string]] : []),
  ];

  const summary =
    ok && run.kind === "scheduled"
      ? []
      : [
          `<p>${ok ? "✅" : "🚨"} <b>${GAME_LABEL[run.game]} ${escapeHtml(run.kind)}` +
            ` — ${ok ? "ok" : "FAILED"}</b></p>`,
          `<table bordered compact>${counts
            .map(([label, value]) => `<tr><th>${label}</th><td>${value}</td></tr>`)
            .join("")}</table>`,
        ];

  const lines = [
    ...summary,
    ...draws,
    ...failures
      .slice(0, MAX_FAILURE_LINES)
      .map((f) => `<p><code>${escapeHtml(f)}</code></p>`),
  ];

  if (failures.length > MAX_FAILURE_LINES) {
    lines.push(`<p>…and ${failures.length - MAX_FAILURE_LINES} more</p>`);
  }
  return lines.join("\n");
}

/**
 * Report a finished run. Never throws, and does nothing without a token.
 * Only a failure makes a sound: a routine success should not wake anyone.
 */
export const reportRun = (run: RunRow, draws: string[] = []): Promise<boolean> =>
  sendTelegram(formatRun(run, draws), { silent: run.status === "ok" });
