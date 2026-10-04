-- Tickets saved against an upcoming draw. The draw has no number until its
-- results are scraped, so the ticket is bound by date instead; the draw it
-- names is looked up by (game, draw_date) each time it is checked.
--
-- Rows from before this migration have neither a draw_no nor a draw_date.
-- They are left alone, and nothing reads them.

ALTER TABLE tickets ADD COLUMN draw_date TEXT; -- 'YYYY-MM-DD', SGT calendar date

-- The same numbers saved for two different draws are two tickets.
DROP INDEX idx_tickets_unique;
CREATE UNIQUE INDEX idx_tickets_unique
  ON tickets (telegram_user_id, game, numbers, COALESCE(draw_no, 0), COALESCE(draw_date, ''));
CREATE INDEX idx_tickets_user_date ON tickets (telegram_user_id, draw_date DESC);
