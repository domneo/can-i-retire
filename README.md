# Can I Retire?

A small API over Singapore Pools draw results. Scrapes the public results pages
into SQLite and serves them over HTTP.

**Stack:** Node.js · TypeScript · Hono · SQLite (better-sqlite3) · cheerio

See [PLAN.md](PLAN.md) for the full build plan. Current state: phase 1 — TOTO
draws scraped into SQLite, latest draw served over HTTP.

## Setup

```sh
pnpm install
cp .env.example .env   # then set SGPOOLS_CONTACT
```

`SGPOOLS_CONTACT` is required before any scrape run — it goes into the
scraper's User-Agent so Singapore Pools can reach a human.

## Usage

```sh
pnpm scrape   # fetch the latest TOTO draw and upsert it
pnpm dev      # run the API on http://localhost:3000 (watch mode)
```

```sh
curl http://localhost:3000/toto/latest
```

```json
{
  "drawNo": 4217,
  "drawDate": "2026-09-14",
  "numbers": [6, 7, 8, 16, 18, 35],
  "additional": 31
}
```

Returns 404 if nothing has been scraped yet.

## Other scripts

| Script           | Does                          |
| ---------------- | ----------------------------- |
| `pnpm build`     | Compile TypeScript to `dist/` |
| `pnpm start`     | Run the compiled server       |
| `pnpm typecheck` | Type-check without emitting   |

## Layout

```
src/index.ts       Hono server
src/jobs/scrape.ts scrape entry point
src/scrape/        URL building, fetching, HTML parsing
src/db/            SQLite client and queries
data/              SQLite file and archived raw HTML (gitignored)
testdata/          saved pages used as parser fixtures
```

## Config

| Variable          | Default        | Purpose                      |
| ----------------- | -------------- | ---------------------------- |
| `SGPOOLS_CONTACT` | —              | Contact string in User-Agent |
| `SGPOOLS_DB`      | `data/data.db` | SQLite file location         |
| `PORT`            | `3000`         | Server port                  |
