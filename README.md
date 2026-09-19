# Can I Retire?

A small API over Singapore Pools draw results. Scrapes the public results pages
into SQLite and serves them over HTTP.

**Stack:** Node.js · TypeScript · Hono · SQLite (better-sqlite3) · cheerio

See [PLAN.md](PLAN.md) for the full build plan. Current state: phase 3 — TOTO
and 4D scraped into a normalised schema, with prize groups and winning outlets,
served over typed routes, and a year of history backfilled from the site's own
draw-list index.

## Setup

```sh
pnpm install
cp .env.example .env   # then set SGPOOLS_CONTACT
```

`SGPOOLS_CONTACT` is required before any scrape run — it goes into the
scraper's User-Agent so Singapore Pools can reach a human.

## Usage

```sh
pnpm scrape        # fetch the latest draw of both games
pnpm scrape toto   # or just one
pnpm dev           # run the API on http://localhost:3000 (watch mode)
```

Migrations are applied automatically when the database is opened, so there is
no separate step before the first scrape. `pnpm migrate` reports what ran.

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

## Other scripts

| Script           | Does                          |
| ---------------- | ----------------------------- |
| `pnpm build`     | Compile TypeScript to `dist/` |
| `pnpm start`     | Run the compiled server       |
| `pnpm typecheck` | Type-check without emitting   |
| `pnpm test`      | Golden-file parser tests      |
| `pnpm migrate`   | Report which migrations ran   |

## Layout

```
src/index.ts       OpenAPIHono app
src/routes/        typed routes, one file per game
src/schema/        Zod schemas — types, validation, and phase 6's OpenAPI doc
src/jobs/          scrape and backfill entry points
src/scrape/        URL building, fetching, HTML parsing
src/db/            SQLite client, migration runner, queries
migrations/        numbered .sql, applied on connect
data/              SQLite file and archived raw HTML (gitignored)
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

| Variable          | Default        | Purpose                      |
| ----------------- | -------------- | ---------------------------- |
| `SGPOOLS_CONTACT` | —              | Contact string in User-Agent |
| `SGPOOLS_DB`      | `data/data.db` | SQLite file location         |
| `PORT`            | `3000`         | Server port                  |
