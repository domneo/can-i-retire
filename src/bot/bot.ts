// The Telegram bot: grammY handlers over the stored draws. Runs behind the
// webhook in src/routes/telegram.ts; nothing here polls.
//
// A check is two steps. Numbers in, and the bot offers the upcoming draw and
// the last few stored ones as buttons. A button press checks the numbers
// against that one draw. Picking the upcoming draw also saves the ticket, and
// /retire shows the upcoming and latest draw of each game with the tickets
// saved for them.
//
// Private chats only (PRD: group chats are out of scope for v1). Anything
// from a group is ignored rather than answered.

import { Bot, GrammyError, type BotConfig, type Context } from "grammy";
import { saveTicket, upsertUser } from "../db/tickets.js";
import { checkDraw, checkOverview, checkUpcoming, drawOptions } from "./check.js";
import { decodeChoice } from "./choice.js";
import {
  ASK_NUMBERS,
  drawKeyboard,
  ERROR,
  invalidTicket,
  notDrawnYet,
  overviewMessages,
  PHOTO_UNSUPPORTED,
  pickDraw,
  resultMessage,
  savedNote,
  STALE_BUTTON,
  WELCOME,
} from "./reply.js";
import { parseTicket } from "./ticket.js";

/** "Can I retire?" in any case, with or without the question mark. */
const CAN_I_RETIRE = /^\s*can\s+i\s+retire\s*[?!.]*\s*$/i;

const html = (ctx: Context, text: string) => ctx.reply(text, { parse_mode: "HTML" });

/** Results are rich messages, for their tables. `text` is rich HTML. */
const rich = (ctx: Context, text: string) => ctx.replyWithRichMessage({ html: text });

/**
 * `config` is for tests, which pass `botInfo` to skip the getMe call.
 * `now` is for tests too: it decides which draw is upcoming.
 */
export function createBot(
  token: string,
  config?: BotConfig<Context>,
  now: () => Date = () => new Date(),
): Bot {
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

  // Every private update registers its sender, so a later push has a chat to
  // address.
  dm.use(async (ctx, next) => {
    await upsertUser(ctx.from.id, ctx.chat.id);
    await next();
  });

  // The latest and upcoming draw of each game, with the tickets saved for
  // them. Shown even with no tickets saved: the draws are worth seeing.
  // Three messages, sent in order: each waits for the one before.
  const retire = async (ctx: Context & { from: { id: number } }) => {
    for (const text of overviewMessages(await checkOverview(ctx.from.id, now()))) {
      await rich(ctx, text);
    }
  };

  dm.command("start", (ctx) => html(ctx, WELCOME));
  dm.command("retire", retire);
  dm.hears(CAN_I_RETIRE, retire);

  dm.on("message:photo", (ctx) => html(ctx, PHOTO_UNSUPPORTED));

  dm.on("message:text", async (ctx) => {
    const parsed = parseTicket(ctx.message.text);
    if (parsed.kind === "none") return html(ctx, ASK_NUMBERS);
    if (parsed.kind === "invalid") return html(ctx, invalidTicket(parsed.reason));

    const { ticket } = parsed;
    const options = await drawOptions(ticket.game, now());
    return ctx.reply(pickDraw(ticket), {
      parse_mode: "HTML",
      reply_markup: drawKeyboard(ticket, options),
    });
  });

  // The answer replaces the message the button is on, and the keyboard stays,
  // so another draw can be picked for the same numbers without typing them
  // again — and the chat does not fill up with one reply per press.
  dm.on("callback_query:data", async (ctx) => {
    await ctx.answerCallbackQuery();

    /**
     * `result` is rich HTML, anything else plain HTML. `keep: false` drops the
     * keyboard: a stale one would only fail again.
     */
    const show = async (text: string, { result = true, keep = true } = {}) => {
      const message = ctx.callbackQuery.message;
      const keyboard =
        keep && message && "reply_markup" in message ? message.reply_markup : undefined;
      try {
        await (result
          ? ctx.editMessageText({ html: text }, { reply_markup: keyboard })
          : ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard }));
      } catch (err) {
        if (!(err instanceof GrammyError)) throw err;
        // The same button twice: the answer is already on screen.
        if (err.description.includes("message is not modified")) return;
        // Too old or gone: answer below it instead.
        await (result ? rich(ctx, text) : html(ctx, text));
      }
    };

    const choice = decodeChoice(ctx.callbackQuery.data);
    if (!choice) return show(STALE_BUTTON, { result: false, keep: false });
    if (choice.kind === "draw") {
      return show(resultMessage(await checkDraw(choice.ticket, choice.drawNo)));
    }
    // Saved whatever the check finds: a draw whose results are not out yet
    // is exactly what a later /retire is for.
    const isNew = await saveTicket(ctx.from.id, choice.ticket, choice.date);
    const checked = await checkUpcoming(choice.ticket, choice.date, now());
    const reply =
      checked === "not drawn" ? notDrawnYet(choice.ticket, choice.date) : resultMessage(checked);
    return show(`${reply}\n${savedNote(isNew)}`);
  });

  return bot;
}
