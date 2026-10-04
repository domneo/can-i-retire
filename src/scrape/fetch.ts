import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { put } from "@vercel/blob";

/**
 * Contact address published in the User-Agent so the site operator can reach
 * someone. No default: a placeholder address is worse than none, because it
 * looks reachable and bounces.
 *
 * Checked on first fetch, not at import: the deployed API imports this module
 * through the cron route, and a scraper setting must not take the read routes
 * down with it. A missing contact fails the run, which then reports itself.
 */
function userAgent(): string {
  const contact = process.env.SGPOOLS_CONTACT;
  if (!contact) {
    throw new Error(
      "SGPOOLS_CONTACT is unset — set it to a real contact address (see .env.example)",
    );
  }
  return `can-i-retire/1.0 (${contact})`;
}

const BACKOFF_MS = [2_000, 8_000, 30_000];

// Politeness limiter: one request every 2 seconds across the whole process.
// The interval is what keeps the load light; the jitter only stops a long
// backfill from hitting at exactly 2.000s intervals for eleven minutes.
const MIN_INTERVAL_MS = 2_000;
const JITTER_MS = 500;

// The earliest time the next request may go out. Callers are not queued: each
// takes the next free time, pushes this past it, and sleeps until then.
let nextAt = 0;

/**
 * Sleep until this caller's turn to send.
 *
 * `nextAt` is updated before the await, not after. Two callers starting in the
 * same tick therefore get different slots; sleeping first and updating
 * afterwards would hand both the same slot and send them together.
 */
async function waitForSlot(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextAt);
  nextAt = slot + MIN_INTERVAL_MS + Math.random() * JITTER_MS;
  if (slot > now) await sleep(slot - now);
}

/**
 * Fetch one results page, rate-limited to 0.5 req/s across the process.
 * Retries 5xx with backoff, never retries 4xx.
 */
export async function fetchPage(url: string): Promise<string> {
  const ua = userAgent();
  let lastError = "";
  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt++) {
    await waitForSlot();
    const res = await fetch(url, {
      headers: { "User-Agent": ua },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) return res.text();
    if (res.status < 500) throw new Error(`HTTP ${res.status} for ${url}`);
    lastError = `HTTP ${res.status}`;
    await sleep(BACKOFF_MS[attempt]!);
  }
  throw new Error(`exhausted retries (${lastError}) for ${url}`);
}

/**
 * Archive the page before parsing it. Every parse bug stays replayable and
 * re-parsing later never needs the network.
 *
 * To Vercel Blob when a store token is set, because a function's disk does not
 * outlive the invocation; to data/raw/ otherwise. Returns the Blob URL or the
 * local path, whichever it wrote.
 */
export async function archive(
  game: string,
  drawNo: number,
  html: string,
): Promise<string> {
  const path = `raw/${game}/${drawNo}.html`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    // Same pathname every time: the daily scrape re-fetches the latest draw,
    // and the archive should hold the most recent copy, not a pile of them.
    const blob = await put(path, html, {
      access: "private",
      contentType: "text/html; charset=utf-8",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return blob.url;
  }

  const local = `data/${path}`;
  await mkdir(`data/raw/${game}`, { recursive: true });
  await writeFile(local, html);
  return local;
}
