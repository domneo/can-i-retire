// Telegram transport. Plain fetch against the Bot API — one method, no SDK.
//
// Nothing here ever throws. A notification is not worth failing a scrape over,
// so every failure is logged and swallowed; the caller gets a boolean it is
// free to ignore.

const API = "https://api.telegram.org";

/** Telegram rejects a longer `text` outright. */
const MAX_TEXT = 4096;

const TIMEOUT_MS = 15_000;

/** HTML parse_mode needs exactly these three escaped, and nothing else. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Cut an over-long message at a line boundary.
 *
 * Every message this project builds keeps its tags within a single line, so
 * cutting at a newline can never leave a `<code>` unclosed. The hard slice is
 * the fallback for a single monstrous line, and drops any tag it bisects.
 */
function truncate(text: string): string {
  if (text.length <= MAX_TEXT) return text;
  const head = text.slice(0, MAX_TEXT - 2);
  const nl = head.lastIndexOf("\n");
  return (nl > 0 ? head.slice(0, nl) : head.replace(/<[^>]*$/, "")) + "\n…";
}

/** True when both env vars are set, i.e. when a send would actually go out. */
export const telegramConfigured = (): boolean =>
  Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);

/**
 * Send one message. Returns false when it did not arrive — including the
 * unconfigured case, where no request is made at all.
 */
export async function sendTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  // No token, no send: the job runs exactly as it did before.
  if (!token || !chatId) return false;

  try {
    const res = await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: truncate(text),
        parse_mode: "HTML",
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // The API answers 200 with `ok: false` for a bad chat id or malformed
    // entities, so the status line alone does not mean the message arrived.
    const body = (await res.json()) as { ok?: boolean; description?: string };
    if (body.ok === true) return true;

    console.error(
      `telegram: send failed — HTTP ${res.status}` +
        (body.description ? `: ${body.description}` : ""),
    );
    return false;
  } catch (err) {
    console.error(
      `telegram: send failed — ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}
