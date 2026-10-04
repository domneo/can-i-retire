// The whole flow, update in and reply out: real grammY handlers over a real
// (in-memory) database, with only the Telegram API faked.

process.env.TURSO_DATABASE_URL = ":memory:";
delete process.env.TURSO_AUTH_TOKEN;

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { Update } from "grammy/types";

const { db } = await import("../db/client.js");
const { migrate } = await import("../db/migrate.js");
const { writeFourd, writeToto } = await import("../db/queries.js");
const { createBot } = await import("./bot.js");

await migrate(db);

const bot = createBot("0:test", {
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
});

// Every API call lands here instead of on Telegram.
const sent: string[] = [];
bot.api.config.use(async (_prev, method, payload) => {
  if (method === "sendMessage") sent.push((payload as { text: string }).text);
  return { ok: true, result: true } as never;
});

let updateId = 0;
/** Send `text` from `userId` in a private chat; returns the bot's replies. */
async function say(text: string, userId = 42): Promise<string[]> {
  sent.length = 0;
  const command = text.match(/^\/\w+/)?.[0];
  const update = {
    update_id: ++updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: { id: userId, type: "private", first_name: "U" },
      from: { id: userId, is_bot: false, first_name: "U" },
      text,
      ...(command && { entities: [{ type: "bot_command", offset: 0, length: command.length }] }),
    },
  } as Update;
  await bot.handleUpdate(update);
  return [...sent];
}

const meta = { rawPath: "test", contentHash: "x" };

test("/retire with no tickets asks for numbers", async () => {
  const [reply] = await say("/retire");
  assert.match(reply!, /^Provide draw numbers\./);
});

test("a ticket sent before any results are stored is not called a loss", async () => {
  const [reply] = await say("2 14 16 21 36 47");
  assert.match(reply!, /Saved your TOTO ticket\./);
  assert.match(reply!, /results not published yet/);
  assert.doesNotMatch(reply!, /no prize/);
});

test("/retire checks every stored ticket against the latest draw", async () => {
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
  await writeFourd(
    {
      drawNo: 5535,
      drawDate: "2026-09-13",
      first: "8608",
      second: "4918",
      third: "9832",
      starter: ["0427"],
      consolation: ["0217"],
    },
    meta,
  );

  await say("0427");
  const [reply] = await say("Can I retire?");
  assert.equal(
    reply,
    [
      "🎉 <b>You can retire!!!</b>",
      "",
      "<b>TOTO 4217</b> · Mon 14 Sep 2026 · 2 14 16 21 36 47 (+1)",
      "• 2 14 16 21 36 47 — Group 1 $1,553,027",
      "",
      "<b>4D 5535</b> · Sun 13 Sep 2026 · 1st 8608 · 2nd 4918 · 3rd 9832",
      "• 0427 — Starter prize: $250 Big, Small pays nothing, per $1",
    ].join("\n"),
  );
});

test("the same ticket twice is stored once", async () => {
  const [reply] = await say("0427");
  assert.match(reply!, /You already sent this 4D ticket\./);
  const rs = await db.execute("SELECT COUNT(*) AS n FROM tickets WHERE game = '4d'");
  assert.equal(rs.rows[0]!.n, 1);
});

test("tickets are private to the user who sent them", async () => {
  const [reply] = await say("/retire", 99);
  assert.match(reply!, /^Provide draw numbers\./);
});

test("a malformed ticket gets the format rule", async () => {
  const [reply] = await say("1 2 3 4 5 5");
  assert.match(reply!, /cannot repeat a number/);
  assert.match(reply!, /TOTO: 6 to 12 different numbers/);
});

test("group chats are ignored", async () => {
  sent.length = 0;
  await bot.handleUpdate({
    update_id: ++updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: { id: -100, type: "group", title: "G" },
      from: { id: 42, is_bot: false, first_name: "U" },
      text: "/retire",
    },
  } as Update);
  assert.deepEqual(sent, []);
});
