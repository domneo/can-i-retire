# Can I Retire?

A small API over Singapore Pools draw results. Scrapes the public results pages
into SQLite and serves them over HTTP.

**Stack:** Node.js · TypeScript · Hono · SQLite (libSQL: Turso deployed, a local
file otherwise) · cheerio · Vercel

See [PLAN.md](PLAN.md) for the full build plan. Current state: phase 3 — TOTO
and 4D scraped into a normalised schema, with prize groups and winning outlets,
served over typed routes, and a year of history backfilled from the site's own
draw-list index.

## Setup

```sh
pnpm install
vercel link                  # once, to the can-i-retire project
vercel env pull .env.local   # every variable, from Vercel's Development env
```

`.env.local` is the only env file the scripts read. Vercel's Development
environment is its source, so change a value there and pull again rather
than editing the file: the next pull overwrites it.

That file points the scripts at the production Turso database and Blob store,
and at the Telegram chat. To work against a local SQLite file instead, start
from `.env.example`:

```sh
cp .env.example .env.local   # then set SGPOOLS_CONTACT
pnpm migrate                 # create the schema in data/data.db
```

`SGPOOLS_CONTACT` is required before any scrape run — it goes into the
scraper's User-Agent so Singapore Pools can reach a human.

## Usage

```sh
pnpm scrape        # fetch the latest draw of both games
pnpm scrape toto   # or just one
pnpm dev           # run the API on http://localhost:3000 (watch mode)
```

Migrations are not applied on open: a serverless function opens a connection
per cold start and does not ship `migrations/`. Run `pnpm migrate` after
adding a migration; it applies to whichever database the env names.

### Backfill

```sh
pnpm backfill -- --dry-run                      # count what a run would fetch
pnpm backfill -- --since 2025-09-16             # both games, one date window
pnpm backfill -- --game toto --since 2025-09-16 # one game
```

| Flag        | Default      | Meaning                                 |
| ----------- | ------------ | --------------------------------------- |
| `--game`    | both         | `toto` or `4d`; repeatable              |
| `--since`   | one year ago | Oldest draw date to fetch, `YYYY-MM-DD` |
| `--until`   | no bound     | Newest draw date to fetch               |
| `--dry-run` | off          | Fetch only the draw lists, then report  |

The job reads the draw-list index, filters it by date, and fetches what is
left — no probing and no stopping condition to get wrong. Requests are rate
limited to 0.5/s, so a one-year window is about eleven minutes. Cancelled
draws and draws already stored are skipped, and a re-run writes nothing it
already has, so an interrupted run just needs running again.

One failed page does not abandon the run: failures are collected, reported at
the end, and recorded in `scrape_runs` along with the page and write counts.

### Scrape reports

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` and every run posts one message
per game to that chat, so an unattended job is visible without reading logs.
Leave either unset and nothing is sent — no request is made at all, and the job
behaves exactly as before.

```
✅ <b>TOTO manual — ok</b>
1 draw written · 3 pages · 5s
TOTO 4218 · Thu 17 Sep 2026 · 17 19 23 35 36 39 (+49) · Group 1 $1,248,856 · [snowballed]
```

```
🚨 <b>TOTO manual — FAILED</b>
0 draws written · 2 pages · 2s · 1 failure
<code>toto 4218: page served no results block</code>
```

The failure message is the point of the feature. A parser broken by a site
redesign writes no draws, and no draws is exactly what a quiet week looks like;
only an explicit alert tells the two apart. A backfill reports the same way, but
counts only — hundreds of draw lines is not a notification. A successful
scheduled run drops the header and counts and posts only the draw; a failed one
keeps them.

The message is built from the run's `scrape_runs` row, so the chat and the
database cannot disagree. A send that fails is logged and swallowed: a
notification is not worth failing a scrape over.

### Routes

| Route           | Returns               |
| --------------- | --------------------- |
| `/toto/latest`  | Most recent TOTO draw |
| `/toto/:drawNo` | One TOTO draw         |
| `/4d/latest`    | Most recent 4D draw   |
| `/4d/:drawNo`   | One 4D draw           |

404 when the draw is not stored, 400 when the draw number is not a number.

```sh
curl http://localhost:3000/toto/latest
```

```json
{
  "game": "toto",
  "drawNo": 4217,
  "drawDate": "2026-09-14",
  "numbers": [6, 7, 8, 16, 18, 35],
  "additional": 31,
  "group1PrizeCents": 310605500,
  "snowballed": false,
  "cascadeDraw": false,
  "prizeGroups": [{ "group": 1, "shareCents": 155302700, "winners": 2 }],
  "outlets": [{ "group": 1, "name": "...", "address": null, "entry": "..." }],
  "scrapedAt": "2026-09-15 03:41:10"
}
```

4D numbers are strings, not integers: `0427` is a different 4D number from
`427`, and an integer column loses the distinction.

## Bot

The Telegram bot answers in private chats; group messages are ignored.

| Message                        | Reply                                                |
| ------------------------------ | ---------------------------------------------------- |
| `0427`                         | 4D: asks which draw to check against                 |
| `2 14 16 21 36 47` (6–12 nums) | TOTO, System entries too: asks which draw            |
| `/retire` or "Can I retire?"   | Upcoming and latest draws, with your saved tickets   |
| Anything else                  | The number format rule                               |

The question comes with one button per draw: the upcoming draw, then the last
four stored draws of that game, newest first. Pressing one checks the numbers
against that draw:

```
🎉 <b>You can retire!!!</b>

<b>TOTO 4217</b> · Mon 14 Sep 2026 · 2 14 16 21 36 47 (+1)
• 2 14 16 21 36 47 — Group 1 $1,553,027
```

The upcoming draw is the next regular draw day (TOTO Mon and Thu, 4D Wed, Sat
and Sun) that has no stored results. Pressing it says the draw has not happened
yet. An old upcoming button whose draw has since been stored checks that draw;
one whose date has passed without stored results says results are not
published yet. The bot never reports a loss without results to back it.

Pressing the upcoming draw also saves the ticket for that draw date.
`/retire` or "Can I retire?" then answers in three messages, TOTO before 4D
in each:

1. **The verdict**, then the newest stored draw of each game, with the
   tickets saved for it checked against it.
2. **Upcoming draws:** the next draw of each game, with the tickets saved for
   it. A draw after the latest stored one whose results never arrived shows
   here too, as "results not published yet", so a saved ticket is never
   dropped silently.
3. **What to send next.**

```
🎉 <b>You can retire!!!</b>
<b>TOTO 4217</b> · Mon 14 Sep 2026 · 2 14 16 21 36 47 (+1)
<b>4D 5536</b> · Sun 4 Oct 2026 · 1st 8608 · 2nd 4918 · 3rd 9832
• 0427 — Starter prize: $250 Big, Small pays nothing, per $1
```

```
📅 <b>Upcoming draws</b>
<b>TOTO</b> · Mon 5 Oct 2026
• 2 14 16 21 36 47
<b>4D</b> · Wed 7 Oct 2026
• No tickets saved
```

```
Send numbers to add another ticket.
```

Tickets saved for draws older than the latest stored one are not shown, and
only the latest draws decide the verdict. With nothing saved, the same
messages are sent, and the last one gives the number format rule.

A saved ticket is bound by date, not draw number: the draw has no number until
its results are scraped, so each check looks the draw up by game and date.
Picking a past draw checks the numbers once and saves nothing. The numbers ride
in the button's callback data and are parsed again when it is pressed. TOTO amounts
come from the draw's prize groups, and a System entry is checked as every
six-number combination it covers. 4D checks a straight match only and quotes
the Big and Small payout per $1 from `fourd_prize_schedule`.

Telegram delivers updates to `POST /telegram/webhook`. The route refuses
everything until both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` are
set, and then accepts only requests carrying that secret. Register the webhook
once per deployment URL, and again whenever the update types it asks for
change (it now needs `callback_query` for the draw buttons):

```sh
pnpm webhook https://<deployment-host>
```

Not built yet: photo tickets, scraping a missing draw on demand, pushes when
results land, `/subscribe`, and `/suggest`.

## Deployment

The API runs on Vercel as one function (`src/index.ts`'s default export), in
`iad1`, next to the Turso database (`aws-us-east-1`). A read is two database
round trips, so the function sits by the database rather than by the results
site. The raw-page archive is a private Vercel Blob store.

A Vercel Cron calls `GET /cron/scrape` daily at 14:00 UTC (22:00 SGT, after
every draw's results are out). On the Hobby plan the call lands anywhere in
that hour. The route needs `Authorization: Bearer $CRON_SECRET`, which Vercel
sends itself; without `CRON_SECRET` set, it refuses every request. Runs are
recorded with kind `scheduled` and reported to Telegram like any other.

The cron fetches the latest draw only. Vercel does not retry a failed or
missed invocation, so a gap is closed with a backfill:

```sh
pnpm backfill -- --since 2026-09-01
```

To trigger the scheduled scrape by hand:

```sh
vercel crons run /cron/scrape
```

## Other scripts

| Script           | Does                          |
| ---------------- | ----------------------------- |
| `pnpm build`     | Compile TypeScript to `dist/` |
| `pnpm start`     | Run the compiled server       |
| `pnpm typecheck` | Type-check without emitting   |
| `pnpm webhook`   | Register the bot's webhook    |
| `pnpm test`      | Parser, bot and query tests   |
| `pnpm migrate`   | Apply pending migrations      |

## Layout

```
src/index.ts       OpenAPIHono app; Vercel's entrypoint
src/serve.ts       local Node server around the app
src/routes/        typed routes, one file per game, and the cron route
src/schema/        Zod schemas — types, validation, and phase 6's OpenAPI doc
src/jobs/          scrape and backfill entry points
src/notify/        Telegram transport (grammY) and the run report it sends
src/scrape/        URL building, fetching, HTML parsing
src/db/            libSQL client, migration runner, queries
migrations/        numbered .sql, applied on connect
data/              local SQLite file and raw HTML archive (gitignored)
testdata/          saved pages used as parser fixtures
```

## How "latest" is resolved

Both results pages publish a static draw-list index that the page itself loads
client-side, for example:

```
https://www.singaporepools.com.sg/DataFileArchive/Lottery/Output/toto_result_draw_list_en.html
```

Each is a bare `<select>` of roughly three years of draws, newest first, with
the draw number in `value` and the date as the option text. That list is the
source of truth for "latest" and for which draw numbers exist, so nothing in
this project probes for draw numbers.

Two things it settles that the plan left open:

- **Draw numbers are contiguous.** Cascade and Hongbao draws sit in the same
  sequence as ordinary ones and appear in the same list; parallel
  `..._cascade_draw_list_en.html` and `..._hongbao_draw_list_en.html` files are
  how you tell which is which. `toto_results.cascade_draw` comes from there.
- **Draw days are not fixed.** The current TOTO list holds 12 Friday draws (the
  Hongbao ones) alongside the usual Monday and Thursday ones, so nothing here
  validates a draw against a weekday timetable. The list itself says which
  draws exist and when.

Unlike TOTO, requesting the 4D page with no `sppl` parameter returns an _empty_
results block, because that view is populated client-side. Always resolve a
draw number first.

## Config

| Variable                | Default        | Purpose                                 |
| ----------------------- | -------------- | --------------------------------------- |
| `SGPOOLS_CONTACT`       | —              | Contact string in User-Agent            |
| `TURSO_DATABASE_URL`    | —              | Turso database; unset uses `SGPOOLS_DB` |
| `TURSO_AUTH_TOKEN`      | —              | Token for `TURSO_DATABASE_URL`          |
| `SGPOOLS_DB`            | `data/data.db` | Local SQLite file location              |
| `BLOB_READ_WRITE_TOKEN` | —              | Archive raw pages to Blob, not `data/`  |
| `CRON_SECRET`           | —              | Bearer token `/cron/scrape` requires    |
| `PORT`                  | `3000`         | Server port                             |
| `TELEGRAM_BOT_TOKEN`    | —              | Unset disables scrape reports           |
| `TELEGRAM_CHAT_ID`      | —              | Chat the reports are sent to            |
