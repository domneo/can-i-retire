# SG Pools Results API — Build Plan

**Stack:** Node.js · TypeScript · Hono · SQLite · cheerio
**Approach:** Walking skeleton first. Each phase is runnable and useful on its own.

> **Revision 8.** Phases 0–2 are built, and building them settled most of section 11. The large
> correction: the site publishes a static **draw-list index** for each game — roughly three years of
> draw numbers and dates, in one file. Nothing in this project needs to probe for draw numbers, and
> phase 3 shrinks accordingly. Two rules in section 7 were wrong: the sequence-tolerance rule is now
> an exact check against the list, and the weekday rule is gone rather than patched, since draw days
> are the operator's to change. Everything about the stack, the data model and phases 5–7 stands.
>
> _Revision 7 resolved dependency versions against the registry (14 Sep 2026): Zod 4,
> `better-sqlite3` 13, TypeScript 7, Node 26._

---

## 1. Scope

| Question         | Answer                                        | Consequence                                      |
| ---------------- | --------------------------------------------- | ------------------------------------------------ |
| Historical depth | One year back                                 | 260 requests, ~9 minute backfill                 |
| Consumers        | Internal / single user                        | One bearer token, no rate limiting, no quotas    |
| Data captured    | Numbers **+** prize amounts and winner counts | TOTO only — see caveat                           |
| Fetching         | Plain `fetch`, no browser                     | No Playwright, no browser binaries               |
| Extraction       | cheerio selectors                             | No model, no GPU, no inference dependency        |
| Storage          | SQLite, single file                           | No DB server, no connection pool, trivial backup |

**Out of scope:** prediction, betting integration, Singapore Sweep and sports, headless browsers,
LLM extraction.

**4D prize caveat.** 4D prize amounts are a _fixed published schedule_ ($2,000 per $1 Big bet for
1st Prize, $3,000 Small, and so on) — not per-draw values — and Singapore Pools does not publish 4D
winner counts. "Prizes + winner counts" therefore applies to TOTO only. For 4D the complete per-draw
dataset is the 23 numbers. Keep the 4D prize schedule as a small static reference table.

**Legal note.** Terms of service are at `/en/rules/Pages/website-tnc.html` and are generally
understood to restrict automated access. For an internal single-user project the practical risk is
low, but read them, keep request rates polite, and reconsider if this ever becomes public.

---

## 2. Stack choices

| Concern           | Pick                                    | Why                                                                        |
| ----------------- | --------------------------------------- | -------------------------------------------------------------------------- |
| Runtime           | **Node 26**                             | Active LTS from 28 Oct 2026, supported to Apr 2029. Boring, universal.     |
| TypeScript        | `tsx` in dev, `tsc` for build           | Dependable. See the type-stripping note below.                             |
| API               | **Hono** + `@hono/node-server`          | Tiny, fast, fully typed. Portable off Node later if you ever want to be.   |
| HTML parsing      | **cheerio**                             | jQuery-style API, mature, exactly right for static markup.                 |
| Database          | **SQLite** via `better-sqlite3`         | Synchronous, no pool, no async ceremony. `db.transaction()` matters here.  |
| Schema/validation | **Zod 4**                               | One schema gives you the TS type, runtime validation, and the OpenAPI doc. |
| Migrations        | Numbered `.sql` files + ~30-line runner | Drizzle is fine later; for one dev and ten tables it's overhead.           |
| Tests             | `node:test` + `node:assert`             | Built in, no framework to install.                                         |
| HTTP client       | Built-in `fetch`                        | Stable in Node since 21. Nothing else needed.                              |

### Node-specific decisions worth understanding

**Hono needs an adapter on Node.** `@hono/node-server` — Hono's own `app.fetch` is Web-standard, and
Node needs the bridge. One extra import, easy to forget:

```ts
import { serve } from "@hono/node-server";
serve({ fetch: app.fetch, port: 3000 });
```

**`better-sqlite3` over `node:sqlite`.** The built-in `node:sqlite` module landed in v22.5.0 behind a
flag, lost the flag while remaining experimental, and is still marked _Stability 1.2 — release
candidate_ in the Node 26 docs. It's genuinely tempting: zero dependencies, no native addon, and the
same synchronous `DatabaseSync` shape. Two things keep it out of the default. It has no
`db.transaction()` wrapper, and this project's core write path is exactly a transaction — one draw
plus six numbers plus seven prize groups plus outlet rows, all atomic or none. And it's still RC.

Be honest that the transaction helper is about eight lines to hand-roll; the real argument is
maturity. The old counter-argument — that the native addon costs you at deploy time — no longer
holds. As of v13, `better-sqlite3` ships prebuilt binaries for every platform inside the tarball:
`gypfile` is false, `prebuild-install` and `bindings` are gone, the only dependency is
`node-addon-api`, and the exports map includes `linuxmusl-x64` and `linuxmusl-arm64`. No node-gyp,
no download at install time, and musl is a first-class target. The package is ~27 MB unpacked as a
result, which on this project is a non-issue. Engines is `>=22`.

If you'd still rather have zero dependencies and don't mind hand-rolling `BEGIN`/`COMMIT`,
`node:sqlite` remains a reasonable swap — both APIs are synchronous, so the data layer changes in
one file.

**TypeScript execution.** Node strips types natively on recent versions, so `node src/index.ts` just
works — but that path forbids enums, parameter properties, and namespaces (set
`erasableSyntaxOnly: true` in tsconfig so the compiler tells you before Node does). None of those
appear in this plan, so native stripping is viable. `tsx` in dev and `tsc` to `dist/` for production
is still the path with the fewest surprises, particularly around `node --test`.

**TypeScript 7 is what `latest` now installs.** It's the Go rewrite, shipped from the ordinary
`typescript` package with the native binary delivered through ~20 platform-specific optional
dependencies. The tsconfig in section 5 — `nodenext`, `es2023`, `strict`, `erasableSyntaxOnly` —
compiles and emits correctly under 7.0.2. The one risk is third-party `.d.ts` files using legacy
syntax: TS 7 rejects `export declare module X {}` as a parse error, and `skipLibCheck` does not
suppress it because it's syntax-level, not type-level. If that prospect bothers you, `typescript@^6`
is the last JS-based compiler and warns about everything 7 removes. Either choice is invisible to
`tsx`, which uses esbuild and never invokes `tsc`.

**If you'd rather use Bun:** swap `better-sqlite3` for `bun:sqlite`, drop `@hono/node-server` and
`tsx`, and use `bun test` instead of `node --test`. Everything else in this plan is identical —
Hono, cheerio, Zod, and the schema are all runtime-agnostic.

**A note on Node versions.** Node 26 becomes Active LTS on 28 Oct 2026 and is supported to Apr 2029.
Node 24 leaves Active LTS on 20 Oct 2026 and is supported to Apr 2028. Since this plan runs longer
than six weeks, target 26 and skip an upgrade; if you want an LTS line today, use 24 and set
`@types/node` to `^24` to match.

### Dependencies

Resolved against the registry on 14 Sep 2026.

```json
{
  "dependencies": {
    "hono": "^4.13.7",
    "@hono/node-server": "^2.1.1",
    "@hono/zod-openapi": "^1.6.3",
    "better-sqlite3": "^13.0.3",
    "cheerio": "^1.2.0",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "typescript": "^7.0.2",
    "tsx": "^4.23.13",
    "@types/node": "^26.5.1",
    "@types/better-sqlite3": "^9.6.0"
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "tsx --test \"src/**/*.test.ts\"",
    "migrate": "tsx src/db/migrate.ts",
    "scrape": "tsx src/jobs/scrape.ts",
    "backfill": "tsx src/jobs/backfill.ts"
  }
}
```

Three of these pins carry a consequence rather than just a number:

- **Zod 4 is mandatory, not optional.** `@hono/zod-openapi@1.x` declares peers `zod ^4.0.0` and
  `hono >=4.10.0`. There is no maintained version of it that accepts Zod 3. Write the phase 2
  schemas in Zod 4 from the start rather than migrating at phase 6.
- **`@hono/node-server` is on 2.x** (peer `hono ^4`, engines `>=20`). The `serve({ fetch: app.fetch,
port })` call shape is unchanged, so this is purely the pin.
- **The test glob needs quoting.** pnpm runs scripts through `sh`, which does not expand `**`
  recursively; unquoted, you silently test a subset. Quoted, Node's test runner does the globbing.

**One thing to verify yourself:** `@types/better-sqlite3` is numbered 9.x while the runtime package
is 13.x, and v13 ships no bundled types. DefinitelyTyped majors don't have to track the library, and
9.6.0 is recently published, but confirm the API surface you use is actually typed before
committing.

**A note on "API-first" in this stack.** In Go the flow is spec → codegen → handlers. The idiomatic
TypeScript inversion is `@hono/zod-openapi`: you write Zod schemas, and the OpenAPI document is
generated from them. Same guarantee that contract and implementation can't silently drift, without
maintaining YAML by hand.

It is not, however, a layer you bolt on at the end. Adopting it means swapping `Hono` for
`OpenAPIHono`, rewriting every route as `createRoute()` plus `app.openapi(route, handler)`, and
importing `z` from `@hono/zod-openapi` rather than from `zod` so that `.openapi()` metadata exists.
That's a rewrite of `routes/`, not a decoration. So: plain `Hono` in phase 1, where there is one
throwaway route, and `OpenAPIHono` from phase 2 onward, where the routes are meant to last. Phase 6
then really is cheap — it's just `app.doc()` and a docs UI.

---

## 3. Source endpoints — CONFIRMED

Both results pages accept a base64-encoded draw number and return **complete server-rendered HTML**.

```
sppl = base64("DrawNumber=" + N)

TOTO  https://www.singaporepools.com.sg/en/product/sr/Pages/toto_results.aspx?sppl=<sppl>
4D    https://www.singaporepools.com.sg/en/product/pages/4d_results.aspx?sppl=<sppl>
```

Verified samples:

| URL param              | Decodes to        | Returns                                                                                                           |
| ---------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `RHJhd051bWJlcj00MDk5` | `DrawNumber=4099` | TOTO, Mon 28 Jul 2025 — 2·14·16·21·36·47, additional 1, Group 1 $5,853,782 snowballed, full Group 1–7 share table |
| `RHJhd051bWJlcj01MDE3` | `DrawNumber=5017` | 4D, Wed 24 May 2023 — 1st 8608, 2nd 4918, 3rd 9832, 10 Starter, 10 Consolation                                    |

```ts
const BASE = {
  toto: "https://www.singaporepools.com.sg/en/product/sr/Pages/toto_results.aspx",
  "4d": "https://www.singaporepools.com.sg/en/product/pages/4d_results.aspx",
} as const;

export const drawUrl = (game: keyof typeof BASE, drawNo: number) =>
  `${BASE[game]}?sppl=${encodeURIComponent(
    Buffer.from(`DrawNumber=${drawNo}`).toString("base64"),
  )}`;
```

**Gotcha:** always pass `sppl`. The 4D page with no `sppl` returns an **empty** results block to a
plain HTTP client, because that view is populated client-side. The TOTO page happens to render its
latest draw server-side without one, but relying on that asymmetry is not worth the two lines it
saves.

### 3.1 The draw-list index — how "latest" is actually resolved

Each results page fetches a static index file client-side to fill its draw dropdown. Those files are
plain, tiny, and the authoritative answer to both "what is the latest draw" and "which draw numbers
exist":

```
https://www.singaporepools.com.sg/DataFileArchive/Lottery/Output/<file>

toto_result_draw_list_en.html            TOTO, all draws
fourd_result_draw_list_en.html           4D, all draws
toto_result_cascade_draw_list_en.html    TOTO cascade draws only
toto_result_hongbao_draw_list_en.html    TOTO Hongbao draws only
```

Each is a bare `<select>` and nothing else, newest first:

```html
<option queryString='sppl=RHJhd051bWJlcj00MjE3' value='4217'
        winningSharesUploaded='True' isCancelled=''>Mon, 14 Sep 2026</option>
```

Three consequences, all of which simplify later phases:

- **Nothing probes.** No upward search for "latest", no absurd draw number to discover what a miss
  looks like, no `±3` sequence estimate. Read the list, take entry 0.
- **Draw numbers are contiguous, and cascade and Hongbao draws share the sequence.** Confirmed on
  15 Sep 2026: TOTO 3905–4217 is 313 entries with no gaps, 4D 5066–5535 is 470. Cascade and Hongbao
  draws appear in the main list like any other; the two extra files are how you tell which is which,
  and are where `toto_results.cascade_draw` comes from.
- **The list carries `isCancelled`.** A cancelled draw has no results to parse. Note that cheerio
  lowercases attribute names in HTML mode, so it is reachable as `iscancelled` and not otherwise —
  a silent `undefined` if you spell it as the source does.

**Backfill window** — measured from the lists on 15 Sep 2026, not estimated:

| Game | Days               | List holds      | Oldest listed    | One year back     | Requests |
| ---- | ------------------ | --------------- | ---------------- | ----------------- | -------- |
| TOTO | Mon, Thu, some Fri | 313 (3905–4217) | Mon, 18 Sep 2023 | 4114, 18 Sep 2025 | 104      |
| 4D   | Wed, Sat, Sun      | 470 (5066–5535) | Sat, 16 Sep 2023 | 5380, 17 Sep 2025 | 156      |

260 requests for a year ending 14 Sep 2026. At one every 2 seconds: about nine minutes. These are
counted from the lists, not derived from a draws-per-year figure, so the arithmetic that revision 7
worried about no longer applies.

Both lists reach back three years, so the one-year window in section 1 is a choice rather than a
limit — widening it later costs only time. Size the job from the list itself: filter it by
`draw_date` and count what remains.

**Bonus field.** TOTO pages list the outlets where Group 1 and Group 2 tickets were sold. Cheap to
capture while you're already parsing, annoying to backfill later.

---

## 4. Phases

Ordered by complexity. Every phase ends with something that runs. Stop whenever it's good enough —
phases 0–3 already give you a queryable year of results.

### Phase 0 — One file, one draw ★☆☆☆☆ — **built**

_~50 lines, an afternoon._ No database, no server, no framework.

```ts
// scratch/spike.ts  —  npx tsx scratch/spike.ts 4099
import * as cheerio from "cheerio";

const drawNo = Number(process.argv[2]);
const sppl = Buffer.from(`DrawNumber=${drawNo}`).toString("base64");
const url = `https://www.singaporepools.com.sg/en/product/sr/Pages/toto_results.aspx?sppl=${encodeURIComponent(
  sppl,
)}`;

const html = await fetch(url).then((r) => r.text());
console.log(JSON.stringify(extractToto(cheerio.load(html)), null, 2));
```

Genuinely one file — `src/` doesn't exist yet, so the URL helper is inlined here and promoted to
`src/scrape/url.ts` in phase 1.

**Done when:** it prints correct numbers for draw 4099, and you've saved that HTML to
`testdata/toto/4099.html`.

**What you learn:** the actual DOM structure, which is the only genuinely unknown thing in this
project. Everything after is plumbing.

---

### Phase 1 — MVP: fetch → SQLite → one endpoint ★★☆☆☆ — **built**

_A day._ The walking skeleton. TOTO only, latest draw only, one table, one route.

```ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();
app.get("/toto/latest", (c) =>
  c.json(db.prepare("SELECT * FROM draws ORDER BY draw_no DESC LIMIT 1").get()),
);

serve({ fetch: app.fetch, port: 3000 });
```

- `data.db` with a single `draws` table — `draw_no`, `draw_date`, `numbers` (JSON text), `additional`.
- `pnpm run scrape` fetches the latest draw and upserts it.
- `pnpm run dev` starts Hono on :3000.

**Done when:** `curl localhost:3000/toto/latest` returns real data that you scraped yourself.

**Deliberately skipped:** 4D, prize tables, validation, auth, migrations, tests. All of it comes
later and none of it changes this shape.

---

### Phase 2 — Both games, real schema ★★☆☆☆ — **built**

_A day or two._

- Proper normalised tables (section 6), created by numbered migration files.
- Seed `fourd_prize_schedule` as static data in the same migration — it's a published table, it
  never arrives from a scrape, and it's five rows.
- 4D parser alongside TOTO.
- Prize groups and winner counts for TOTO.
- Routes: `/toto/latest`, `/toto/:drawNo`, `/4d/latest`, `/4d/:drawNo`.
- Switch to `OpenAPIHono` and `createRoute()` here, not at phase 6. Zod 4 schemas for the response
  shapes, with `z` imported from `@hono/zod-openapi`.
- Compute and store `content_hash` on write — the hash of the extracted results block, not the whole
  page. Phase 5's reconciliation depends on it and it costs nothing to add now.
- Wrap the multi-table insert in `db.transaction()`. A draw with half its prize groups written is
  worse than no draw at all.

**Done when:** both games round-trip from fetch to JSON response with prize data intact.

**As built**, with three notes worth carrying forward:

- **Migrations run when the connection opens**, not as a separate step. `queries.ts` prepares its
  statements at import time, so anything else means preparing against tables that do not exist yet.
  `migrate(db)` takes the connection as an argument rather than importing `client.ts`, because a
  module cycle between the two resolves differently depending on which is imported first.
- **The write path already has phase 5's replace semantics.** On conflict it `UPDATE`s the `draws`
  row and replaces the child rows, keeping `draws.id` stable. Phase 3 adds an insert-if-absent path
  next to it rather than the other way round.
- **Reads filter on `state = 'ok'`.** That clause is what keeps phase 4's quarantined rows off the
  public routes, and it costs nothing to write before there are any.

---

### Phase 3 — Backfill a year ★☆☆☆☆ — **next**

_Half a day, plus nine minutes of waiting._ **Smaller than revision 7 assumed**: section 3.1's draw
list removes the probing, the termination condition and the sequence arithmetic all at once.

- `pnpm run backfill -- --game toto --since 2025-09-16`.
- **Fetch the draw list, filter it by `draw_date`, fetch what comes back.** That is the whole
  algorithm. No walking backwards, no stopping condition to get right, no computed `--from`, and no
  risk of a silent hole where a cascade draw perturbed the sequence. Skip entries flagged
  `isCancelled`, and skip draw numbers already stored.
- Rate limit at 0.5 req/s. Save every raw HTML to `data/raw/<game>/<drawNo>.html` — phase 2 already
  archives to that layout.
- Idempotent: `INSERT ... ON CONFLICT(game, draw_no) DO NOTHING`. Safe to re-run. Note that this is
  the _backfill_ write path only — phase 2 built the replace path, and phase 5 uses that one instead;
  see section 9.
- Assert contiguity while you are here: the list should have no gaps, and a gap means either a
  genuine event or a wrong assumption, both worth knowing before phase 4 writes rules about it.

**Done when:** ~260 draws in the database and ~260 HTML files on disk.

**Why here:** from this point parser work is a fast offline loop against a year of real edge cases,
with no network in the way.

---

### Phase 4 — Validation and quarantine ★★★☆☆

_A day._ This is where the project becomes trustworthy.

- Zod schemas with refinements enforcing the domain rules in section 7. Write those rules _after_
  the phase 3 archive exists, from what the pages actually contain — see the caveat in section 7.
  The draw-list files give you a second, independent check for free: every stored `draw_no` should
  appear in the list with the same `draw_date`.
- **A quarantined draw is a row in `draws` with a `raw_path` and nothing in the typed tables.** This
  is the only version that works: `toto_results.additional_number` is NOT NULL and the child tables
  carry CHECK constraints, so a parse that fails validation is precisely the one that cannot be
  written into them. Validate first, then write the typed rows only on success. The alternative —
  nullable child columns with every constraint moved into Zod — gives up the database's own
  guarantees to store data you've already decided is wrong.
- `GET /admin/quarantine` therefore reviews raw HTML plus the validation errors, not parsed records.
- `POST /admin/quarantine/:id/approve` re-parses from `raw_path` and re-validates. If it now passes,
  the typed rows are written and `state` flips to `ok`; if it still fails, the response says so. This
  makes `raw_path` mandatory rather than nullable.
- **Archive sweep test:** parse and validate all ~260 stored files, assert 100% pass. This is the
  regression suite, and phase 3 already paid for it. A one-year window contains at least one Hongbao
  draw and several cascade draws, so the sweep is the thing that proves section 7's day rule is
  right rather than merely plausible.

**Done when:** the sweep is green, and deliberately breaking a selector produces quarantined rows
instead of silently wrong data.

---

### Phase 5 — Scheduler ★★★☆☆

_Half a day._ First phase that has to run unattended.

- Draw-day windows: from 18:45 SGT, probe `last + 1` every 10 minutes, stop on success or after 90
  minutes. Extra 21:45 window on TOTO days for cascade draws.
- Daily 03:00 SGT reconciliation over the last 7 days — prize tables get corrected after publication.
- `setInterval` plus a timezone check is genuinely enough. `croner` if you want cron syntax.
- Run it in the same process as the API, or as a second entrypoint against the same SQLite file.

**Done when:** two consecutive real draws land without you touching anything.

---

### Phase 6 — API polish ★★★☆☆

_A day._ Only worth doing once the response shapes have stopped moving.

- `app.doc()` over the schemas you've been writing since phase 2 → `/openapi.json`, plus Scalar or
  Swagger UI at `/docs`. Cheap precisely because the `OpenAPIHono` migration already happened.
- List endpoints with cursor pagination and date filtering.
- Bearer-token middleware on everything.
- `ETag` and long `Cache-Control` on single-draw routes — those records are immutable.
- RFC 9457 `application/problem+json` error shape.

---

### Phase 7 — Deploy ★★☆☆☆

_Half a day._

- Multi-stage Dockerfile: `node:26` builder running `pnpm ci` and `tsc`, then `node:26-slim` runtime
  with `pnpm ci --omit=dev`.
- **Alpine is fine now.** `better-sqlite3` v13 ships musl prebuilds in the tarball, so there's no
  node-gyp step and no `python3 make g++` in the builder. `-slim` is still the default recommendation
  on general principle, but the native addon is no longer the reason.
- `typescript` is a devDependency, so TS 7's platform-specific native binary is only ever pulled in
  the builder stage. Nothing native reaches the runtime image except `better-sqlite3`.
- SQLite file on a mounted volume. Litestream to S3 or a nightly `.backup` to a second volume —
  SQLite's simplicity is only an advantage if the file survives.
- `docker compose up` on any cheap VPS. No database service to run.

---

### Complexity summary

| Phase        | Effort | Risk              | Runnable output   | State |
| ------------ | ------ | ----------------- | ----------------- | ----- |
| 0 Spike      | ★☆☆☆☆  | Only real unknown | Printed JSON      | built |
| 1 MVP        | ★★☆☆☆  | None              | Working endpoint  | built |
| 2 Both games | ★★☆☆☆  | None              | Full current data | built |
| 3 Backfill   | ★☆☆☆☆  | Rate limiting     | A year of history | next  |
| 4 Validation | ★★★☆☆  | Fiddly edge cases | Trustworthy data  |       |
| 5 Scheduler  | ★★★☆☆  | Timezones         | Unattended        |       |
| 6 API polish | ★★★☆☆  | None              | Documented API    |       |
| 7 Deploy     | ★★☆☆☆  | Backups           | Running somewhere |       |

Phase 3 drops a star against revision 7: with the draw list doing the enumerating, the job is a
filter and a loop.

---

## 5. Repository layout

```
src/
  index.ts          OpenAPIHono app + @hono/node-server bootstrap
  routes/
    toto.ts
    fourd.ts
    admin.ts        phase 4
  scrape/
    fetch.ts        rate-limited fetch + retry, archive to data/raw/
    parse-toto.ts   cheerio selectors
    parse-4d.ts
    draw-list.ts    the <select> index — see section 3.1
    url.ts          drawUrl + drawListUrl
    date.ts         "Mon, 28 Jul 2025" -> "2025-07-28", shared by all parsers
    hash.ts         content_hash over canonical JSON of extracted values
    errors.ts       NoSuchDrawError, shared by both parsers
  db/
    client.ts       better-sqlite3 connection + pragmas + migrate on open
    migrate.ts      numbered .sql runner, takes the connection as an argument
    migrate-cli.ts  `pnpm run migrate`, reports what ran
    queries.ts      prepared statements
  schema/
    draw.ts         Zod schemas — types, validation, OpenAPI
  jobs/
    scrape.ts
    backfill.ts     phase 3
    scheduler.ts    phase 5
migrations/
  001_init.sql
testdata/           saved HTML, committed
data/
  data.db           gitignored
  raw/<game>/<drawNo>.html   gitignored
dist/               gitignored
tsconfig.json
```

Flat and boring. No interfaces, no dependency injection, no `internal/`. There is one data source,
one parser per game, one database file. Add indirection when a second implementation appears.

`migrations/` is resolved from the module rather than from cwd — `src/db/` and `dist/db/` are both
two levels below the project root, so `new URL("../../migrations/", import.meta.url)` works either
way. It does need copying into the phase 7 image.

`tsconfig.json` essentials: `"module": "nodenext"`, `"target": "es2023"`, `"strict": true`,
`"erasableSyntaxOnly": true`. Verified to compile and emit under TypeScript 7.0.2. With `nodenext`
and ESM you need `.js` extensions on relative imports even though the files are `.ts` — the single
most common Node-TypeScript papercut.

---

## 6. Data model

SQLite differences from a Postgres design: no arrays, no enums, no native `TIMESTAMPTZ`. All three
have clean substitutes.

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE draws (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  game       TEXT NOT NULL CHECK (game IN ('toto','4d')),
  draw_no    INTEGER NOT NULL,
  draw_date  TEXT NOT NULL,              -- 'YYYY-MM-DD'
  state      TEXT NOT NULL DEFAULT 'ok' CHECK (state IN ('ok','quarantined')),
  source     TEXT NOT NULL DEFAULT 'selector' CHECK (source IN ('selector','manual')),
  raw_path   TEXT NOT NULL,              -- data/raw/toto/4099.html — required, see phase 4
  content_hash TEXT NOT NULL,            -- hash of the results block, not the page
  scraped_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (game, draw_no)
);
CREATE INDEX idx_draws_date ON draws (game, draw_date DESC);

CREATE TABLE toto_results (
  draw_id            INTEGER PRIMARY KEY REFERENCES draws(id) ON DELETE CASCADE,
  additional_number  INTEGER NOT NULL,
  group1_prize_cents INTEGER,
  snowballed         INTEGER NOT NULL DEFAULT 0,
  cascade_draw       INTEGER NOT NULL DEFAULT 0
);

-- Row per number, not a JSON blob: makes "which draws contained 17" a real query.
CREATE TABLE toto_numbers (
  draw_id  INTEGER NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 6),
  number   INTEGER NOT NULL CHECK (number BETWEEN 1 AND 49),
  PRIMARY KEY (draw_id, position)
);
CREATE INDEX idx_toto_numbers ON toto_numbers (number);

CREATE TABLE toto_prize_groups (
  draw_id      INTEGER NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  prize_group  INTEGER NOT NULL CHECK (prize_group BETWEEN 1 AND 7),
  share_cents  INTEGER,                  -- NULL when the page shows '-'
  winner_count INTEGER,
  PRIMARY KEY (draw_id, prize_group)
);

CREATE TABLE toto_winning_outlets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  draw_id     INTEGER NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  prize_group INTEGER NOT NULL,
  outlet_name TEXT NOT NULL,
  outlet_addr TEXT,
  entry_desc  TEXT
);

CREATE TABLE fourd_results (
  draw_id INTEGER PRIMARY KEY REFERENCES draws(id) ON DELETE CASCADE,
  first   TEXT NOT NULL CHECK (length(first)  = 4),
  second  TEXT NOT NULL CHECK (length(second) = 4),
  third   TEXT NOT NULL CHECK (length(third)  = 4)
);

CREATE TABLE fourd_prizes (
  draw_id  INTEGER NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('starter','consolation')),
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 10),
  number   TEXT NOT NULL CHECK (length(number) = 4),
  PRIMARY KEY (draw_id, category, position)
);

CREATE TABLE fourd_prize_schedule (
  effective_from TEXT NOT NULL,
  prize_tier     TEXT NOT NULL,
  big_cents      INTEGER NOT NULL,
  small_cents    INTEGER,
  PRIMARY KEY (effective_from, prize_tier)
);

CREATE TABLE scrape_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL,           -- backfill | scheduled | manual
  game          TEXT NOT NULL,
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT,
  status        TEXT NOT NULL,
  pages_fetched INTEGER NOT NULL DEFAULT 0,
  draws_written INTEGER NOT NULL DEFAULT 0,
  error         TEXT
);
```

Things that will bite if ignored:

- **4D numbers must be `TEXT`.** `0427` stored as INTEGER becomes `427`. The `length() = 4` checks
  are your guard.
- **Money as INTEGER cents.** Safe: JS numbers hold integers exactly up to 2^53, and a jackpot in
  cents is nine digits. `better-sqlite3` returns INTEGERs as JS numbers unless you enable BigInt
  mode, which you don't need here.
- **Booleans are 0/1 integers.** Coerce in the Zod schema, not scattered through handlers.
- **Dates as ISO text.** `'YYYY-MM-DD'` sorts correctly as a string. Draw dates are SGT calendar
  dates, not instants, so no timezone conversion is needed on storage.
- **Raw HTML on disk, not in the DB.** Paths in `raw_path`. Keeps the database small and makes
  golden-file tests trivial — they just read `testdata/`.
- **The CHECK constraints are deliberately strict, which is why quarantine lives in `draws` alone.**
  A quarantined draw has a `draws` row and no child rows. Nothing that failed validation ever
  reaches `toto_results` or `fourd_results`. See phase 4.
- **Hash the results block, not the response body.** These are ASP.NET pages; per-request viewstate
  and markup noise mean a whole-page hash changes on every fetch, and reconciliation would flag all
  seven days every night. Hash the normalised extracted values instead.
- **Pragmas run on every connection**, not once at creation. Put them in `db/client.ts` immediately
  after opening. `foreign_keys` in particular is off by default and silently so.
- **One writer at a time.** WAL plus a 5-second busy timeout covers the API reading while the
  scheduler writes. At five draws a week you will never see contention.
- **`cascade_draw` does not come from the page.** Nothing in the TOTO results markup says a draw was
  a cascade draw; the flag comes from membership in `toto_result_cascade_draw_list_en.html`. The
  Hongbao list works the same way if a Hongbao flag is ever wanted.

`migrations/001_init.sql` is the authoritative version of the above. It differs only by tightening:
CHECK constraints on `additional_number` and on the 0/1 booleans, an index on
`toto_winning_outlets (draw_id)`, and the `fourd_prize_schedule` seed rows. Note that the seeded
`effective_from` is the archive floor — the oldest draw the site still lists — and not a verified
date on which the published schedule changed.

---

## 7. Validation rules

With no model in the pipeline, wrong data comes from selectors silently matching the wrong element —
which is exactly what happens after a site redesign. Selectors fail quietly, so validation is the
safety net. Encode these as Zod refinements:

- TOTO: exactly 6 numbers, each 1–49, all distinct; additional number 1–49 and not among the six.
- TOTO prize groups: exactly 7 rows. Group 1 showing `-` is a legitimate NULL, not a failure.
- 4D: exactly 23 numbers — 1st, 2nd, 3rd, 10 Starter, 10 Consolation — each matching `/^\d{4}$/`.
- **No day-of-week rule.** Revision 7 validated the draw date against a fixed weekday set, and
  revision 8 tried to patch it by adding Friday. Neither is safe: the schedule is the operator's to
  change, special draws already break it, and a rule that encodes a timetable quarantines good data
  the moment the timetable moves. The draw-list check below covers what the day rule was reaching
  for — that the date belongs to the draw — without assuming anything about when draws happen.
- **The draw number parsed from the page equals the one you requested.** This catches the nastiest
  failure mode — the site quietly serving the latest draw when it doesn't recognise your `sppl`.
  Phase 2 enforces this in the scrape job already.
- **The draw number and date appear together in the draw list.** This replaces revision 7's "within
  ±3 of the expected sequence position" rule, which existed only because there was no authoritative
  list to check against. There is one (section 3.1), so check against it: an exact match against
  published data beats a tolerance window around an estimate, and it does not drift.

Failures go to `state = 'quarantined'`, never to public endpoints. At 260 records a year, reviewing
every quarantined row by hand is completely feasible.

---

## 8. Fetching

```ts
export async function fetchDraw(game: Game, drawNo: number): Promise<string> {
  await limiter.acquire(); // 0.5 req/s with jitter
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(drawUrl(game, drawNo), {
      headers: { "User-Agent": "can-i-retire/1.0 (you@example.com)" },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) return res.text();
    if (res.status < 500) throw new Error(`HTTP ${res.status}`); // never retry 4xx
    await setTimeout([2_000, 8_000, 30_000][attempt]); // node:timers/promises
  }
  throw new Error("exhausted retries");
}
```

- Write the HTML to `data/raw/<game>/<drawNo>.html` **before** parsing. Every parse bug becomes
  replayable, and widening the backfill window later is additive.
- Detect "no such draw" by response _shape_, not status code: the site returns 200 with an empty
  `.divSingleDraw`. Both parsers treat a missing *or childless* results block as `NoSuchDrawError`.
  This is no longer a loop-termination condition anywhere — the draw list says which draws exist —
  so it is now purely a guard against asking for something that isn't there.
- The draw-list files are static and small. Fetching one costs a request but saves the probing that
  revision 7 budgeted for, so the polite-rate arithmetic in section 3 is unchanged.

---

## 9. Scheduling

| Game | Days          | Draw time (SGT)             |
| ---- | ------------- | --------------------------- |
| TOTO | Mon, Thu      | 18:30 (cascade draws 21:30) |
| 4D   | Wed, Sat, Sun | 18:30                       |

Draw-day capture from 18:45 SGT: poll the draw list every 10 minutes and fetch anything newer than
what is stored; stop on first successful write or after 90 minutes. Extra 21:45 window on TOTO days.
Polling the list rather than guessing `last_known + 1` also means a cancelled draw announces itself
instead of looking like a page that has not published yet.

Daily 03:00 SGT reconciliation over the last 7 days, comparing `content_hash` — prize tables get
corrected after publication, and `UNIQUE (game, draw_no)` makes the re-check cheap.

**Reconciliation needs its own write path**, and phase 2 already built it: `writeToto` / `writeFourd`
upsert the `draws` row and replace the child rows inside one transaction, leaving `draws.id` alone.
The backfill's `ON CONFLICT DO NOTHING` is the other path, and using it here would discard exactly
the corrections this job exists to catch. Never delete the `draws` row and let the FK cascade clear
the children — that changes the `id`, which anything holding a reference will not thank you for.

Use `Intl.DateTimeFormat` with `timeZone: 'Asia/Singapore'` to evaluate the window rather than doing
offset arithmetic. Singapore has no DST, so this is easier than most timezone work, but hardcoding
+08:00 will still burn you if the process runs anywhere else.

Retention: 260 rows a year. Don't prune — keeping everything means the one-year decision stays
reversible.

---

## 10. Testing

`node --test`, no framework to install. Run through `tsx` so the TypeScript resolves:
`tsx --test src/**/*.test.ts`.

- **Golden files.** Parsers are pure `(html: string) => Draw` functions over `testdata/`. Zero
  network in unit tests.
- **Archive sweep.** Parse and validate every stored file, assert 100% pass. Free after phase 3,
  runs in well under a second at 260 pages. This is the real regression suite.
- **In-memory SQLite** (`new Database(":memory:")`) for query tests, with migrations in `beforeEach`.
  No containers, no fixtures to tear down.
- **Route tests** via `app.request("/toto/latest")` — Hono's built-in test helper, no server and no
  `@hono/node-server` needed.
- **Nightly smoke test** hitting one live URL and alerting on parser drift. This is now your only
  early warning for a site redesign, so point it somewhere you'll actually see it. Fetching a draw
  list too is nearly free and catches a different failure: the index moving or changing shape would
  break "latest" for both games at once.

---

## 11. Remaining unknowns

Answered by building phases 0–2 (15 Sep 2026):

1. ~~Does `sr/Pages/fourd_results.aspx` exist?~~ **Moot.** `product/pages/4d_results.aspx` parses in
   about 50 lines — three prize cells by class, two tbodies of ten — so a leaner page would buy
   nothing.
2. ~~Current draw numbers — probe upward from the anchors.~~ **No probing.** The draw lists in
   section 3.1 are authoritative and current: TOTO 4217 (Mon, 14 Sep 2026), 4D 5535 (Sun, 13 Sep
   2026).
3. ~~How does the site respond to an out-of-range draw number?~~ **200 with an empty
   `.divSingleDraw`** — the same shape as the unparameterised 4D page. Both parsers treat a missing
   or childless block as a miss. Phase 3 no longer depends on this, since nothing loops until a miss.
4. ~~How are cascade and Hongbao draws represented?~~ **Same sequence, same list.** Draw numbers are
   contiguous across both. The separate cascade and Hongbao list files identify them. Hongbao draws
   fall on Fridays, which is what killed section 7's old weekday rule.
5. ~~Does `@types/better-sqlite3@9.x` cover the v13 API surface?~~ **Yes** for everything phase 2
   touches: `pragma`, `prepare`, `transaction`, `get`/`all`/`run`, and `RETURNING` via `.get()`.
   `tsc --noEmit` is clean under TypeScript 7 with `strict` and `noUncheckedIndexedAccess`.

Still open:

6. **Does the draw list ever lag the results page?** If the page publishes a draw before the index
   lists it, phase 5's draw-day window would sit idle until the index catches up. Watch the first
   couple of live draws; falling back to `last_known + 1` after, say, 30 quiet minutes is a cheap
   hedge if it turns out to lag.
7. **What does a cancelled draw actually look like?** `isCancelled` exists in the markup but no draw
   in the current three-year window has it set, so the results-page shape for one is unverified.
8. **The 4D prize schedule's real effective date.** The seeded amounts are the published ones, but
   `effective_from` is the archive floor rather than a date anything confirms. The prize-structure
   pages 302 away from a plain client; if per-bet payouts ever matter, chase it then.
