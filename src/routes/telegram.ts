// The bot's webhook. Telegram POSTs every update here, with the secret it was
// given at setWebhook time in `X-Telegram-Bot-Api-Secret-Token`
// (`pnpm webhook` registers both).
//
// Not an OpenAPI route: it is Telegram's endpoint, not part of the API.

import { Hono } from "hono";
import { webhookCallback } from "grammy";
import { createBot } from "../bot/bot.js";

type Handler = ReturnType<typeof webhookCallback<never, "hono">>;

// Built on the first update rather than at import, so the API still serves
// with the bot unconfigured. Kept for the instance's lifetime: the bot's
// getMe runs once per cold start, not once per update.
let handler: Handler | undefined;

export const telegram = new Hono().post("/telegram/webhook", async (c) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  // Fail closed, as /cron/scrape does. Checked here rather than left to
  // grammY's secretToken option: grammY calls getMe before it looks at the
  // header, so a stranger's request would cost a Telegram round trip.
  if (!token || !secret) return c.json({ error: "bot not configured" }, 503);
  if (c.req.header("x-telegram-bot-api-secret-token") !== secret) {
    return c.json({ error: "unauthorized" }, 401);
  }

  handler ??= webhookCallback(createBot(token), "hono");
  return handler(c);
});
