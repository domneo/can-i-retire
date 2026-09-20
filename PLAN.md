# SG Pools Results API — Plan

**Stack:** Node.js · TypeScript · Hono · SQLite · cheerio

Phases 0–3 are built: both games scrape, parse, and store, with a year of history backfilled and
`/toto/*` and `/4d/*` serving it. What follows is what's left.

---

## Next — Telegram scrape reports

Every scrape run reports to a Telegram chat, so an unattended job is visible without checking logs.

- Bot token and chat id from env (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`). No token, no send —
  the job runs as before.
- Send once per run, after the run finishes, from the `scrape_runs` row: kind, game, draws written,
  pages fetched, failures, duration.
- On success, include the draw: `TOTO 4217 · Mon 14 Sep 2026 · 2 14 16 21 36 47 (+1) · Group 1
  $5,853,782`. For 4D, the top three.
- On failure, include the error and the draw numbers that failed. This is the alert that matters —
  a silent parser break after a site redesign looks exactly like a quiet week otherwise.
- Plain `fetch` to `https://api.telegram.org/bot<token>/sendMessage`. No SDK.
- A send that fails is logged and swallowed. Notification is not worth failing a scrape over.

**Done when:** running `pnpm run scrape` puts a message in the chat, and a deliberately broken
selector puts a failure message there instead.

---

## Todo

- **Scheduler.** Draw-day windows from 18:45 SGT: poll the draw list every 10 minutes, stop on first
  write or after 90 minutes; extra 21:45 window on TOTO days for cascade draws. Daily 03:00 SGT
  reconciliation over the last 7 days, comparing `content_hash` — prize tables get corrected after
  publication. Use the phase 2 replace path, not the backfill's `DO NOTHING`. Evaluate windows with
  `Intl.DateTimeFormat` and `timeZone: 'Asia/Singapore'`, never hardcoded +08:00.
- **API polish.** `app.doc()` → `/openapi.json` plus a docs UI, list endpoints with cursor pagination
  and date filtering, bearer-token middleware, `ETag` and long `Cache-Control` on single-draw routes,
  RFC 9457 error shape.
- **Deploy.** Multi-stage Dockerfile on `node:26`, SQLite on a mounted volume, Litestream or a nightly
  `.backup`. `docker compose up` on a cheap VPS.

---

## Open questions

- **What does a cancelled draw look like?** `isCancelled` exists in the markup but no draw in the
  three-year window has it set, so the results-page shape is unverified.
