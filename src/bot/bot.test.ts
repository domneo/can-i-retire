// The whole flow, update in and reply out: real grammY handlers over a real
// (in-memory) database, with only the Telegram API faked.

process.env.TURSO_DATABASE_URL = ":memory:";
delete process.env.TURSO_AUTH_TOKEN;

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { InlineKeyboardMarkup, Update } from "grammy/types";

const { db } = await import("../db/client.js");
const { migrate } = await import("../db/migrate.js");
const { writeFourd, writeToto } = await import("../db/queries.js");
const { createBot } = await import("./bot.js");

await migrate(db);

// Sun 4 Oct 2026, 10:00 SGT: a 4D draw day, the day before a TOTO draw.
const now = new Date("2026-10-04T02:00:00Z");

const bot = createBot(
  "0:test",
  {
    botInfo: {
      id: 1,
      is_bot: true,
      first_name: "Can I Retire",
      username: "can_i_retire_bot",
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    },
  },
  () => now,
);

interface Sent {
  /** True for an edit of the pressed message, false for a new message. */
  edited: boolean;
  /** True for a rich message, whose `text` is rich HTML. */
  rich: boolean;
  text: string;
  /** Each button as "label → callback data". */
  buttons: string[];
}

// Every API call lands here instead of on Telegram.
const sent: Sent[] = [];
let answered = 0;
/** When set, the next edit fails with this description, as Telegram would. */
let editFails: string | null = null;
bot.api.config.use(async (_prev, method, payload) => {
  if (method === "editMessageText" && editFails !== null) {
    const description = editFails;
    editFails = null;
    return { ok: false, error_code: 400, description } as never;
  }
  if (method === "sendMessage" || method === "sendRichMessage" || method === "editMessageText") {
    const { text, rich_message, reply_markup } = payload as {
      text?: string;
      rich_message?: { html: string };
      reply_markup?: InlineKeyboardMarkup;
    };
    const buttons = (reply_markup?.inline_keyboard ?? []).flat();
    sent.push({
      edited: method === "editMessageText",
      rich: rich_message !== undefined,
      text: rich_message?.html ?? text ?? "",
      buttons: buttons.map((b) => `${b.text} → ${"callback_data" in b ? b.callback_data : ""}`),
    });
  }
  if (method === "answerCallbackQuery") answered++;
  return { ok: true, result: true } as never;
});

let updateId = 0;
const privateChat = (userId: number) => ({ id: userId, type: "private", first_name: "U" });
const user = (userId: number) => ({ id: userId, is_bot: false, first_name: "U" });

/** Send `text` from `userId` in a private chat; returns the bot's replies. */
async function say(text: string, userId = 42): Promise<Sent[]> {
  sent.length = 0;
  const command = text.match(/^\/\w+/)?.[0];
  await bot.handleUpdate({
    update_id: ++updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: privateChat(userId),
      from: user(userId),
      text,
      ...(command && { entities: [{ type: "bot_command", offset: 0, length: command.length }] }),
    },
  } as Update);
  return [...sent];
}

/** The keyboard on the message every pressed button sits on. */
const PICKER: InlineKeyboardMarkup = {
  inline_keyboard: [[{ text: "Sun 4 Oct 2026 · upcoming", callback_data: "u:2026-10-04:0427" }]],
};

/** Press the button carrying `data`; returns the bot's replies. */
async function press(data: string, userId = 42): Promise<Sent[]> {
  sent.length = 0;
  await bot.handleUpdate({
    update_id: ++updateId,
    callback_query: {
      id: String(updateId),
      from: user(userId),
      chat_instance: "c",
      data,
      message: {
        message_id: 1,
        date: 0,
        chat: privateChat(userId),
        text: "Check …",
        reply_markup: PICKER,
      },
    },
  } as Update);
  return [...sent];
}

const meta = { rawPath: "test", contentHash: "x" };

const writeFourdOn = (drawNo: number, drawDate: string) =>
  writeFourd(
    {
      drawNo,
      drawDate,
      first: "8608",
      second: "4918",
      third: "9832",
      starter: ["0427"],
      consolation: ["0217"],
    },
    meta,
  );

test("/retire and 'Can I retire?' ask for numbers when nothing is saved", async () => {
  for (const text of ["/retire", "Can I retire?", "can i retire"]) {
    const [reply] = await say(text);
    assert.match(reply!.text, /^Provide draw numbers\./, text);
  }
});

test("with no draws stored, only the upcoming draw is offered", async () => {
  const [reply] = await say("47 2 16 14 21 36");
  assert.equal(reply!.text, "Check <b>TOTO</b> <code>2 14 16 21 36 47</code> against which draw?");
  assert.deepEqual(reply!.buttons, [
    "Mon 5 Oct 2026 · upcoming → u:2026-10-05:2 14 16 21 36 47",
  ]);
});

test("numbers are offered the upcoming draw and the last four, newest first", async () => {
  await writeFourdOn(5531, "2026-09-23");
  await writeFourdOn(5532, "2026-09-26");
  await writeFourdOn(5533, "2026-09-27");
  await writeFourdOn(5534, "2026-09-30");
  await writeFourdOn(5535, "2026-10-03");

  const [reply] = await say("0427");
  assert.equal(reply!.text, "Check <b>4D</b> <code>0427</code> against which draw?");
  assert.deepEqual(reply!.buttons, [
    "Sun 4 Oct 2026 · upcoming → u:2026-10-04:0427",
    "Sat 3 Oct 2026 → d:5535:0427",
    "Wed 30 Sep 2026 → d:5534:0427",
    "Sun 27 Sep 2026 → d:5533:0427",
    "Sat 26 Sep 2026 → d:5532:0427",
  ]);
});

test("a picked draw checks the numbers against that draw", async () => {
  const [reply] = await press("d:5534:0427");
  assert.equal(answered > 0, true);
  assert.equal(reply!.rich, true);
  assert.equal(
    reply!.text,
    [
      "<p>🎉 <b>You can retire!!!</b></p>",
      "<table bordered compact><caption><b>4D 5534</b> · Wed 30 Sep 2026</caption>",
      "<tr><th>1st</th><td>8608</td></tr>",
      "<tr><th>2nd</th><td>4918</td></tr>",
      "<tr><th>3rd</th><td>9832</td></tr>",
      "</table>",
      "<table bordered striped compact><caption>Your tickets · prize per $1 bet</caption>",
      "<tr><th>Ticket</th><th>Prize</th><th>Big</th><th>Small</th></tr>",
      "<tr><td><code>0427</code></td><td><b>Starter</b></td><td>$250</td><td>nothing</td></tr>",
      "</table>",
    ].join("\n"),
  );

  const [loss] = await press("d:5534:1234");
  assert.match(loss!.text, /^<p><b>You cannot retire yet\.<\/b><\/p>/);
  assert.match(loss!.text, /<tr><td><code>1234<\/code><\/td><td>No prize<\/td>/);
});

test("the upcoming draw has not happened yet", async () => {
  const [reply] = await press("u:2026-10-04:0427");
  assert.equal(
    reply!.text,
    [
      "<p><b>You cannot retire yet.</b></p>",
      "<table bordered striped compact><caption><b>4D</b> · Sun 4 Oct 2026 · draw has not happened yet</caption>",
      "<tr><th>Ticket</th></tr>",
      "<tr><td><code>0427</code></td></tr>",
      "</table>",
      "<p>Ticket saved. Send /retire or “Can I retire?” to check your saved tickets.</p>",
    ].join("\n"),
  );

  const [again] = await press("u:2026-10-04:0427");
  assert.match(again!.text, /This ticket is already saved\./);
});

test("an old upcoming button checks the draw once it is stored", async () => {
  await writeToto(
    {
      drawNo: 4217,
      drawDate: "2026-09-14",
      numbers: [2, 14, 16, 21, 36, 47],
      additional: 1,
      group1PrizeCents: 310605500,
      snowballed: false,
      prizeGroups: [{ group: 1, shareCents: 155302700, winners: 2 }],
      outlets: [],
    },
    meta,
  );
  const [reply] = await press("u:2026-09-14:2 14 16 21 36 47");
  assert.equal(
    reply!.text,
    [
      "<p>🎉 <b>You can retire!!!</b></p>",
      "<table bordered compact><caption><b>TOTO 4217</b> · Mon 14 Sep 2026</caption>",
      "<tr><th>Winning</th><td><b>2</b> <b>14</b> <b>16</b> <b>21</b> <b>36</b> <b>47</b></td></tr>",
      "<tr><th>Additional</th><td>1</td></tr>",
      "</table>",
      "<table bordered striped compact><caption>Your tickets</caption>",
      "<tr><th>Ticket</th><th>Matched</th><th>Prize</th></tr>",
      "<tr><td><code>2 14 16 21 36 47</code></td><td>6</td><td><b>Group 1 $1,553,027</b></td></tr>",
      "</table>",
      "<p>Ticket saved. Send /retire or “Can I retire?” to check your saved tickets.</p>",
    ].join("\n"),
  );
});

test("a past date without results is never called a loss or 'not happened'", async () => {
  const [reply] = await press("u:2026-09-17:2 14 16 21 36 47");
  assert.match(reply!.text, /results not published yet/);
  assert.doesNotMatch(reply!.text, /no prize|not happened/);
});

test("/retire checks each saved ticket against the draw it was saved for", async () => {
  const userId = 7;
  await press("u:2026-10-04:0427", userId);
  await press("u:2026-10-04:1234", userId);
  await press("u:2026-10-05:2 14 16 21 36 47", userId);
  await press("u:2026-09-17:2 14 16 21 36 47", userId);
  // A past draw is not saved: only an upcoming pick is.
  await press("d:5534:0427", userId);

  const [before] = await say("/retire", userId);
  assert.equal(
    before!.text,
    [
      "<p><b>You cannot retire yet.</b></p>",
      "<table bordered striped compact><caption><b>TOTO</b> · Mon 5 Oct 2026 · draw has not happened yet</caption>",
      "<tr><th>Ticket</th></tr>",
      "<tr><td><code>2 14 16 21 36 47</code></td></tr>",
      "</table>",
      "<hr/>",
      "<table bordered striped compact><caption><b>4D</b> · Sun 4 Oct 2026 · draw has not happened yet</caption>",
      "<tr><th>Ticket</th></tr>",
      "<tr><td><code>0427</code></td></tr>",
      "<tr><td><code>1234</code></td></tr>",
      "</table>",
      "<hr/>",
      "<table bordered striped compact><caption><b>TOTO</b> · Thu 17 Sep 2026 · results not published yet</caption>",
      "<tr><th>Ticket</th></tr>",
      "<tr><td><code>2 14 16 21 36 47</code></td></tr>",
      "</table>",
      "<p>Send numbers to add another ticket.</p>",
    ].join("\n"),
  );

  // The 4D draw lands; the next ask checks both tickets against it.
  await writeFourdOn(5536, "2026-10-04");
  const [after] = await say("Can I retire?", userId);
  assert.equal(
    after!.text,
    [
      "<p>🎉 <b>You can retire!!!</b></p>",
      "<table bordered striped compact><caption><b>TOTO</b> · Mon 5 Oct 2026 · draw has not happened yet</caption>",
      "<tr><th>Ticket</th></tr>",
      "<tr><td><code>2 14 16 21 36 47</code></td></tr>",
      "</table>",
      "<hr/>",
      "<table bordered compact><caption><b>4D 5536</b> · Sun 4 Oct 2026</caption>",
      "<tr><th>1st</th><td>8608</td></tr>",
      "<tr><th>2nd</th><td>4918</td></tr>",
      "<tr><th>3rd</th><td>9832</td></tr>",
      "</table>",
      "<table bordered striped compact><caption>Your tickets · prize per $1 bet</caption>",
      "<tr><th>Ticket</th><th>Prize</th><th>Big</th><th>Small</th></tr>",
      "<tr><td><code>0427</code></td><td><b>Starter</b></td><td>$250</td><td>nothing</td></tr>",
      "<tr><td><code>1234</code></td><td>No prize</td><td>–</td><td>–</td></tr>",
      "</table>",
      "<hr/>",
      "<table bordered striped compact><caption><b>TOTO</b> · Thu 17 Sep 2026 · results not published yet</caption>",
      "<tr><th>Ticket</th></tr>",
      "<tr><td><code>2 14 16 21 36 47</code></td></tr>",
      "</table>",
      "<p>Send numbers to add another ticket.</p>",
    ].join("\n"),
  );
});

test("saved tickets are private to the user who saved them", async () => {
  const [reply] = await say("/retire", 8);
  assert.match(reply!.text, /^Provide draw numbers\./);
});

test("a draw number that is not stored is never called a loss", async () => {
  const [reply] = await press("d:9999:0427");
  assert.match(reply!.text, /results not published yet/);
  assert.doesNotMatch(reply!.text, /no prize/);
});

test("a button this bot did not write asks for the numbers again", async () => {
  const [reply] = await press("d:5534:12345");
  assert.match(reply!.text, /no longer works/);
  assert.equal(reply!.rich, false);
  // Its keyboard goes too: every button on it would fail the same way.
  assert.equal(reply!.edited, true);
  assert.deepEqual(reply!.buttons, []);
});

test("a press answers in place and keeps the keyboard for another pick", async () => {
  const replies = await press("d:5534:0427");
  assert.equal(replies.length, 1);
  assert.equal(replies[0]!.edited, true);
  assert.deepEqual(replies[0]!.buttons, ["Sun 4 Oct 2026 · upcoming → u:2026-10-04:0427"]);
});

test("the same button twice leaves the answer as it is", async () => {
  editFails = "Bad Request: message is not modified";
  assert.deepEqual(await press("d:5534:0427"), []);
});

test("a message that cannot be edited gets the answer below it", async () => {
  editFails = "Bad Request: message to edit not found";
  const [reply] = await press("d:5534:0427");
  assert.equal(reply!.edited, false);
  assert.equal(reply!.rich, true);
  assert.match(reply!.text, /You can retire!!!/);
});

test("a drawn 4D number is bold in the draw table", async () => {
  const [reply] = await press("d:5534:8608");
  assert.match(reply!.text, /^<tr><th>1st<\/th><td><b>8608<\/b><\/td><\/tr>$/m);
  assert.match(reply!.text, /^<tr><th>2nd<\/th><td>4918<\/td><\/tr>$/m);
});

test("a malformed ticket gets the format rule", async () => {
  const [reply] = await say("1 2 3 4 5 5");
  assert.match(reply!.text, /cannot repeat a number/);
  assert.match(reply!.text, /TOTO: 6 to 12 different numbers/);
});

test("group chats are ignored", async () => {
  sent.length = 0;
  await bot.handleUpdate({
    update_id: ++updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: { id: -100, type: "group", title: "G" },
      from: user(42),
      text: "0427",
    },
  } as Update);
  assert.deepEqual(sent, []);
});
