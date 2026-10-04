// The Telegram bot: grammY handlers over the ticket store. Runs behind the
// webhook in src/routes/telegram.ts; nothing here polls.
//
// Private chats only (PRD: group chats are out of scope for v1). Anything
// from a group is ignored rather than answered.

import { Bot, type BotConfig, type Context } from "grammy";
import { addTicket, ticketsFor, upsertUser } from "../db/tickets.js";
import { checkTickets } from "./check.js";
import {
  ERROR,
  invalidTicket,
  NO_TICKETS,
  PHOTO_UNSUPPORTED,
  resultsMessage,
  savedMessage,
  WELCOME,
} from "./reply.js";
import { canonical, fromRow, parseTicket } from "./ticket.js";

/** "Can I retire?" in any case, with or without the question mark. */
const CAN_I_RETIRE = /^\s*can\s+i\s+retire\s*[?!.]*\s*$/i;

const html = (ctx: Context, text: string) => ctx.reply(text, { parse_mode: "HTML" });

async function retire(ctx: Context & { from: { id: number } }) {
  const rows = await ticketsFor(ctx.from.id);
  if (rows.length === 0) return html(ctx, NO_TICKETS);
  const checked = await checkTickets(rows.map((r) => fromRow(r.game, r.numbers)));
  return html(ctx, resultsMessage(checked));
}

/** `config` is for tests, which pass `botInfo` to skip the getMe call. */
export function createBot(token: string, config?: BotConfig<Context>): Bot {
  const bot = new Bot(token, config);
  const dm = bot.chatType("private");

  // Errors stop here instead of reaching the webhook as a 500. Telegram
  // retries a failed update, and an update that failed once will fail again.
  dm.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      console.error(`bot: update ${ctx.update.update_id} failed —`, err);
      await ctx.reply(ERROR).catch(() => {});
    }
  });

  // Every private message registers its sender, so the user row exists
  // before anything tries to store a ticket against it.
  dm.use(async (ctx, next) => {
    await upsertUser(ctx.from.id, ctx.chat.id);
    await next();
  });

  dm.command("start", (ctx) => html(ctx, WELCOME));
  dm.command("retire", retire);
  dm.hears(CAN_I_RETIRE, retire);

  dm.on("message:photo", (ctx) => html(ctx, PHOTO_UNSUPPORTED));

  dm.on("message:text", async (ctx) => {
    const parsed = parseTicket(ctx.message.text);
    if (parsed.kind === "none") return html(ctx, NO_TICKETS);
    if (parsed.kind === "invalid") return html(ctx, invalidTicket(parsed.reason));

    const { ticket } = parsed;
    const isNew = await addTicket(ctx.from.id, ticket.game, canonical(ticket));
    const [checked] = await checkTickets([ticket]);
    return html(ctx, savedMessage(checked!, isNew));
  });

  return bot;
}
