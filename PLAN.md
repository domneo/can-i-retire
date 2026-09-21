# SG Pools Results API — Plan

**Stack:** Node.js · TypeScript · Hono · SQLite · cheerio

Phases 0–3 are built: both games scrape, parse, and store, with a year of history backfilled and
`/toto/*` and `/4d/*` serving it. Scrape runs report to Telegram. What follows is what's left.

---

## Next — Scheduler

Draw-day windows from 18:45 SGT: poll the draw list every 10 minutes, stop on first write or after
90 minutes; extra 21:45 window on TOTO days for cascade draws. Daily 03:00 SGT reconciliation over
the last 7 days, comparing `content_hash` — prize tables get corrected after publication. Use the
phase 2 replace path, not the backfill's `DO NOTHING`. Evaluate windows with `Intl.DateTimeFormat`
and `timeZone: 'Asia/Singapore'`, never hardcoded +08:00.

The scrape job already opens a `scrape_runs` row per game and reports it, so a scheduled run only
needs to pass its own `kind` instead of `manual`.

---

## Todo

- **API polish.** `app.doc()` → `/openapi.json` plus a docs UI, list endpoints with cursor pagination
  and date filtering, bearer-token middleware, `ETag` and long `Cache-Control` on single-draw routes,
  RFC 9457 error shape.
- **Deploy.** Multi-stage Dockerfile on `node:26`, SQLite on a mounted volume, Litestream or a nightly
  `.backup`. `docker compose up` on a cheap VPS.

---

## Open questions

- **What does a cancelled draw look like?** `isCancelled` exists in the markup but no draw in the
  three-year window has it set, so the results-page shape is unverified.
