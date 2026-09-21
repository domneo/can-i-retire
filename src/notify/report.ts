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

const plural = (n: number, one: string): string =>
  `${n} ${n === 1 ? one : `${one}s`}`;

function duration(seconds: number | null): string {
  if (seconds === null) return "unfinished";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/**
 * Build the message for a finished run. `draws` are pre-formatted one-liners
 * from ./format.js — a per-draw run passes what it wrote, a backfill passes
 * nothing rather than three hundred lines.
 */
export function formatRun(run: RunRow, draws: string[] = []): string {
  const ok = run.status === "ok";
  // The row stores the failures the job collected, one per line.
  const failures = run.error ? run.error.split("\n") : [];

  const lines = [
    `${ok ? "✅" : "🚨"} <b>${GAME_LABEL[run.game]} ${escapeHtml(run.kind)}` +
      ` — ${ok ? "ok" : "FAILED"}</b>`,
    [
      `${plural(run.draws_written, "draw")} written`,
      plural(run.pages_fetched, "page"),
      duration(run.duration_seconds),
      ...(failures.length > 0 ? [plural(failures.length, "failure")] : []),
    ].join(" · "),
    ...draws.map(escapeHtml),
    ...failures
      .slice(0, MAX_FAILURE_LINES)
      .map((f) => `<code>${escapeHtml(f)}</code>`),
  ];

  if (failures.length > MAX_FAILURE_LINES) {
    lines.push(`…and ${failures.length - MAX_FAILURE_LINES} more`);
  }
  return lines.join("\n");
}

/** Report a finished run. Never throws, and does nothing without a token. */
export const reportRun = (run: RunRow, draws: string[] = []): Promise<boolean> =>
  sendTelegram(formatRun(run, draws));
