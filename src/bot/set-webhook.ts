// `pnpm webhook <base-url>`. Points the bot at a deployment's webhook route,
// with the secret that route checks. Run once per URL change, and again when
// allowed_updates below changes; not per deploy: Telegram keeps the
// registration.
//
//   pnpm webhook https://can-i-retire.vercel.app

import { Api } from "grammy";

const base = process.argv[2];
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!base?.startsWith("https://")) {
  console.error("usage: pnpm webhook https://<deployment-host>");
  process.exit(1);
}
if (!token || !secret) {
  console.error("TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must both be set");
  process.exit(1);
}

const url = new URL("/telegram/webhook", base).toString();
const api = new Api(token);
await api.setWebhook(url, {
  secret_token: secret,
  // Only what the bot handles; the rest would be ignored after a round trip.
  allowed_updates: ["message", "callback_query"],
});
const info = await api.getWebhookInfo();
console.log(`webhook set: ${info.url} (${info.pending_update_count} pending)`);
