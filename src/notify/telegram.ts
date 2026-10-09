// Telegram transport. grammY's bare Api client — no Bot, no polling, just
// sendRichMessage. Messages are rich HTML, for tables.
//
// Nothing here ever throws. A notification is not worth failing a scrape over,
// so every failure is logged and swallowed; the caller gets a boolean it is
// free to ignore.

import { Api, GrammyError } from "grammy";

/**
 * Telegram rejects a rich message with more text than this. The limit counts
 * text after parsing, so measuring the HTML is on the safe side.
 */
const MAX_TEXT = 32768;

const TIMEOUT_SECONDS = 15;

/** HTML needs exactly these three escaped, and nothing else. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Cut an over-long message at a line boundary.
 *
 * Every message this project builds puts one whole block on each line, so
 * cutting at a newline can never leave a tag unclosed. The hard slice is
 * the fallback for a single monstrous line, and drops any tag it bisects.
 */
function truncate(text: string): string {
  if (text.length <= MAX_TEXT) return text;
  const head = text.slice(0, MAX_TEXT - 10);
  const nl = head.lastIndexOf("\n");
  return (nl > 0 ? head.slice(0, nl) : head.replace(/<[^>]*$/, "")) + "\n<p>…</p>";
}

/** True when both env vars are set, i.e. when a send would actually go out. */
export const telegramConfigured = (): boolean =>
  Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);

/**
 * Send one rich HTML message. Returns false when it did not arrive — including the
 * unconfigured case, where no request is made at all. A `silent` message
 * arrives without a sound or vibration.
 */
export async function sendTelegram(
  text: string,
  { silent = false }: { silent?: boolean } = {},
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  // No token, no send: the job runs exactly as it did before.
  if (!token || !chatId) return false;

  try {
    const api = new Api(token, { timeoutSeconds: TIMEOUT_SECONDS });
    await api.sendRichMessage(
      chatId,
      { html: truncate(text) },
      { disable_notification: silent },
    );
    return true;
  } catch (err) {
    // GrammyError covers the API saying no (bad chat id, malformed entities);
    // anything else is the network or the timeout.
    const reason =
      err instanceof GrammyError
        ? `${err.error_code}: ${err.description}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error(`telegram: send failed — ${reason}`);
    return false;
  }
}
