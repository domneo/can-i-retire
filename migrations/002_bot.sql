-- The bot's own tables (PRD: data model additions). Existing tables are
-- unchanged; the bot only reads them.

CREATE TABLE users (
  telegram_user_id INTEGER PRIMARY KEY,
  chat_id          INTEGER NOT NULL,        -- where a later push would go
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- `numbers` is canonical text, so the same ticket typed twice is one row:
-- TOTO ascending and space-separated ('2 14 16 21 36 47'), 4D the four digits
-- as typed ('0427' — leading zeros are significant).
--
-- draw_no NULL means unbound: a typed ticket says nothing about its draw, so
-- it is checked against the latest stored draw of its game. A photo carries
-- the draw date, and binds the ticket once OCR lands.
CREATE TABLE tickets (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id INTEGER NOT NULL REFERENCES users(telegram_user_id) ON DELETE CASCADE,
  game             TEXT    NOT NULL CHECK (game IN ('toto','4d')),
  draw_no          INTEGER,
  numbers          TEXT    NOT NULL,
  source           TEXT    NOT NULL DEFAULT 'text' CHECK (source IN ('text','image')),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
-- COALESCE because a UNIQUE index treats every NULL as distinct, which would
-- let unbound duplicates through.
CREATE UNIQUE INDEX idx_tickets_unique
  ON tickets (telegram_user_id, game, numbers, COALESCE(draw_no, 0));
