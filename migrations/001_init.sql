-- Phase 2 schema. Replaces the single ad-hoc `draws` table from phase 1.
--
-- Pragmas are NOT set here: they are per-connection, not per-database, and
-- live in src/db/client.ts. Setting journal_mode inside the runner's
-- transaction would fail anyway.

CREATE TABLE draws (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  game         TEXT    NOT NULL CHECK (game IN ('toto','4d')),
  draw_no      INTEGER NOT NULL,
  draw_date    TEXT    NOT NULL,            -- 'YYYY-MM-DD', SGT calendar date
  state        TEXT    NOT NULL DEFAULT 'ok' CHECK (state IN ('ok','quarantined')),
  source       TEXT    NOT NULL DEFAULT 'selector' CHECK (source IN ('selector','manual')),
  raw_path     TEXT    NOT NULL,            -- data/raw/toto/4099.html
  content_hash TEXT    NOT NULL,            -- hash of the extracted values, not the page
  scraped_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (game, draw_no)
);
CREATE INDEX idx_draws_date ON draws (game, draw_date DESC);

CREATE TABLE toto_results (
  draw_id            INTEGER PRIMARY KEY REFERENCES draws(id) ON DELETE CASCADE,
  additional_number  INTEGER NOT NULL CHECK (additional_number BETWEEN 1 AND 49),
  group1_prize_cents INTEGER,               -- NULL when the page shows '-'
  snowballed         INTEGER NOT NULL DEFAULT 0 CHECK (snowballed IN (0,1)),
  cascade_draw       INTEGER NOT NULL DEFAULT 0 CHECK (cascade_draw IN (0,1))
);

-- Row per number rather than a JSON blob, so "which draws contained 17" is a
-- real query rather than a table scan with a LIKE in it.
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
  share_cents  INTEGER,                     -- NULL when the page shows '-'
  winner_count INTEGER,
  PRIMARY KEY (draw_id, prize_group)
);

CREATE TABLE toto_winning_outlets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  draw_id     INTEGER NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  prize_group INTEGER NOT NULL,
  outlet_name TEXT    NOT NULL,
  outlet_addr TEXT,
  entry_desc  TEXT
);
CREATE INDEX idx_toto_outlets_draw ON toto_winning_outlets (draw_id);

-- 4D numbers are TEXT: '0427' stored as INTEGER comes back as 427.
CREATE TABLE fourd_results (
  draw_id INTEGER PRIMARY KEY REFERENCES draws(id) ON DELETE CASCADE,
  first   TEXT NOT NULL CHECK (length(first)  = 4),
  second  TEXT NOT NULL CHECK (length(second) = 4),
  third   TEXT NOT NULL CHECK (length(third)  = 4)
);

CREATE TABLE fourd_prizes (
  draw_id  INTEGER NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  category TEXT    NOT NULL CHECK (category IN ('starter','consolation')),
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 10),
  number   TEXT    NOT NULL CHECK (length(number) = 4),
  PRIMARY KEY (draw_id, category, position)
);

-- Static reference data. 4D prizes are a published fixed schedule per $1 bet,
-- not per-draw values, and the results pages carry no winner counts for 4D.
CREATE TABLE fourd_prize_schedule (
  effective_from TEXT    NOT NULL,
  prize_tier     TEXT    NOT NULL,
  big_cents      INTEGER NOT NULL,
  small_cents    INTEGER,                   -- NULL: tier pays nothing on Small
  PRIMARY KEY (effective_from, prize_tier)
);

-- effective_from is the floor of this project's archive (the oldest draw the
-- site's own draw list still offers), NOT a verified date on which the
-- schedule changed. Amounts are the currently published ones per $1 bet.
INSERT INTO fourd_prize_schedule (effective_from, prize_tier, big_cents, small_cents) VALUES
  ('2023-09-16', '1st',         200000, 300000),
  ('2023-09-16', '2nd',         100000, 200000),
  ('2023-09-16', '3rd',          49000,  80000),
  ('2023-09-16', 'starter',      25000,   NULL),
  ('2023-09-16', 'consolation',   6000,   NULL);

CREATE TABLE scrape_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT    NOT NULL,           -- backfill | scheduled | manual
  game          TEXT    NOT NULL,
  started_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT,
  status        TEXT    NOT NULL,           -- running | ok | error
  pages_fetched INTEGER NOT NULL DEFAULT 0,
  draws_written INTEGER NOT NULL DEFAULT 0,
  error         TEXT
);
