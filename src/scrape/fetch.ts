import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

// Contact address published in the User-Agent so the site operator can reach
// someone. No default: a placeholder address is worse than none, because it
// looks reachable and bounces.
const CONTACT = process.env.SGPOOLS_CONTACT;
if (!CONTACT) {
  throw new Error(
    "SGPOOLS_CONTACT is unset — set it to a real contact address (see .env.example)",
  );
}
const UA = `sgpools-results/1.0 (${CONTACT})`;

const BACKOFF_MS = [2_000, 8_000, 30_000];

/**
 * Fetch one results page. Retries 5xx with backoff, never retries 4xx.
 *
 * Phase 3 adds the 0.5 req/s limiter in front of this; a single scrape run
 * makes one request, so there is nothing to rate-limit yet.
 */
export async function fetchPage(url: string): Promise<string> {
  let lastError = "";
  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt++) {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
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
 */
export async function archive(name: string, html: string): Promise<string> {
  const path = `data/raw/${name}.html`;
  await mkdir("data/raw", { recursive: true });
  await writeFile(path, html);
  return path;
}
