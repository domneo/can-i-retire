# PRD — Can I Retire?

## About

A Telegram bot that tells you whether your 4D or TOTO ticket won. Send numbers or a photo of
a ticket; the bot stores it, waits for the draw, and replies once results are out. It also
posts draw results on schedule and suggests numbers to buy.

Built on the existing scraper and SQLite store (see [PLAN.md](PLAN.md)): the bot is a new
consumer of `draws` and the per-game results tables, plus two new tables of its own.

## Scope

**In:** Telegram only. 4D and TOTO. Singapore Pools public results as the sole source.
Ordinary, cascade and Hongbao draws.

**Out:** buying tickets, payments, other games, other chat platforms, web UI.

## Users

One Telegram user = one account, keyed by `telegram_user_id`. Tickets are private to the
user who sent them. Group chats are not supported in v1.

## Inputs

### Text

| Input                          | Behaviour                                                   |
| ------------------------------ | ----------------------------------------------------------- |
| "Can I retire?" (or `/retire`) | Evaluate the user's stored tickets for the most recent draw |
| Numbers in a 4D or TOTO shape  | Detect the game, store as a ticket, then evaluate           |
| Anything else                  | "Provide draw numbers, or send a photo of your ticket."     |

Number formats accepted: 4D is four digits (`0427` ≠ `427` — leading zeros are significant).
TOTO is 6–12 distinct numbers in 1–49. Anything ambiguous is rejected with the format rule,
not guessed.

### Image

OCR the photo, then classify it as a 4D ticket, a TOTO ticket, or neither.

- Neither → "You cannot retire yet. This is not a 4D or TOTO ticket."
- Either → extract the numbers and the draw date, confirm the reading back to the user, store
  and evaluate.

Low-confidence OCR asks for confirmation rather than silently evaluating a misread ticket —
a wrong "you cannot retire yet" is the one failure mode a user will not forgive.

## Evaluate and reply

For each stored ticket the user has:

1. **Draw hasn't happened** → "You cannot retire yet. Draw has not occurred." Include the draw
   date, and queue a push for when results land.
2. **Draw happened, results stored** → evaluate and reply.
3. **Draw happened, results missing** → scrape that draw on demand, then evaluate. If the
   scrape fails, say results aren't published yet rather than reporting a loss.
4. **No tickets at all** → "Provide draw numbers, or send a photo of your ticket."

A win replies "You can retire!!!" with the prize group and share amount; a loss replies
"You cannot retire yet." Prize tiers come from the scraped tables, not hardcoded rules:
TOTO from `toto_prize_groups`, 4D from `fourd_prizes` and `fourd_prize_schedule`.

Ticket evaluation is idempotent — re-asking after a draw gives the same answer, and results
corrected by the daily reconciliation re-notify the user if the outcome changed.

## Scheduled results announcements

The scheduler in [PLAN.md](PLAN.md) already scrapes on draw-day windows. On each successful
scrape, push results to every user subscribed to that game (`/subscribe toto`, `/unsubscribe`),
and evaluate any pending tickets for that draw in the same pass.

The operator failure alert stays separate from user-facing announcements.

## Number recommendation engine

`/suggest toto` returns a set of numbers with a one-line rationale drawn from historical
frequency in the stored draws.

Draws are independent, so no analysis improves expected value. The feature is entertainment
and the copy says so in one line — it must not imply an edge.

## Data model additions

- `users` — `telegram_user_id`, chat id, subscriptions, created at.
- `tickets` — user, game, draw number (or draw date until resolved), numbers, bet type, source
  (`text` | `image`), evaluated-at, outcome.

Existing tables are unchanged.

## Success criteria

- A ticket sent before a draw gets an unprompted result within minutes of the scrape.
- No user is ever told they lost on a draw whose results were not actually stored.
- OCR accepts a clear phone photo of a standard ticket without manual correction.

## Open questions

- Which OCR? On-device vs. a vision model — accuracy on thermal-printed tickets decides it.
- 4D bet types: does v1 handle Big/Small and iBet, or only the plain number match?
- What does a cancelled draw look like? Still unverified (see [PLAN.md](PLAN.md)).
- Retention: how long are tickets and photos kept?
