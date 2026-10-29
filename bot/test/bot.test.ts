// End-to-end through handleUpdate with an in-memory store and a recorded Telegram API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { closeExpired, handleUpdate, type Deps } from "../src/bot.ts";
import { MemoryStore } from "./memory-store.ts";

const CHAT = -100123;
function setup(allowed: number[] | null = null) {
  const calls: { method: string; params: any }[] = [];
  let clock = Date.UTC(2026, 10, 2, 10, 0);
  let msgId = 1;
  const d: Deps = {
    store: new MemoryStore(),
    tg: { async call(method, params) { calls.push({ method, params }); return method === "sendMessage" ? { message_id: msgId++ } : true; } },
    now: () => clock, tz: "Europe/Lisbon", allowedChats: allowed, siteUrl: "https://example.github.io/snowfinder/",
  };
  const user = (id: number, first_name: string) => ({ id, first_name });
  const say = (u: any, text: string) => handleUpdate({ message: { chat: { id: CHAT, type: "group" }, from: u, text } }, d);
  const press = (u: any, data: string) => handleUpdate({ callback_query: { id: "q" + Math.random(), from: u, data, message: { chat: { id: CHAT } } } }, d);
  const last = () => calls.filter((c) => c.method === "sendMessage").at(-1)!.params.text as string;
  const answers = () => calls.filter((c) => c.method === "answerCallbackQuery").map((c) => c.params.text);
  return { d, calls, say, press, last, answers, user, tick: (h: number) => { clock += h * 3600e3; } };
}

test("a house needs 4 of 5 and passes as soon as the 4th yes arrives", async () => {
  const t = setup();
  const [ana, bia, cris, duda, edu] = ["Ana", "Bia", "Cris", "Duda", "Edu"].map((n, i) => t.user(i + 1, n));
  for (const u of [ana, bia, cris, duda, edu]) await t.say(u, "/join");
  await t.say(cris, "/propose house Apartaments Superior El Tarter https://www.booking.com/hotel/ad/apartamentos-superior-el-tarter.html");
  assert.match(t.last(), /House \/ hotel<\/b> · vote #1/);
  assert.match(t.last(), /Needs 4 of 5 yes \(80%\)/);
  for (const u of [ana, bia, cris]) await t.press(u, "v:1:y");
  assert.equal((await t.d.store.getVote(1))!.status, "open");
  await t.press(bia, "v:1:n");   // changing your mind is allowed while open
  await t.press(bia, "v:1:y");
  await t.press(duda, "v:1:y");
  assert.equal((await t.d.store.getVote(1))!.status, "passed");
  assert.match(t.last(), /Accepted: <b>Apartaments Superior El Tarter<\/b> \(4 of 5 said yes\)/);
  await t.press(edu, "v:1:n");
  assert.equal(t.answers().at(-1), "This vote is closed.");
});

test("fails early once it can't reach the threshold, and times out otherwise", async () => {
  const t = setup();
  const us = [1, 2, 3, 4, 5].map((i) => t.user(i, "U" + i));
  for (const u of us) await t.say(u, "/join");
  await t.say(us[0], "/propose house Chalet A");
  await t.press(us[1], "v:1:n"); await t.press(us[2], "v:1:n"); // 5 − 2 = 3 < 4
  assert.equal((await t.d.store.getVote(1))!.reason, "blocked");
  await t.say(us[0], "/propose resort Val Thorens");             // 60% of 5 → 3, 72h
  await t.press(us[0], "v:2:y"); await t.press(us[1], "v:2:y");
  t.tick(71); await closeExpired(t.d);
  assert.equal((await t.d.store.getVote(2))!.status, "open");
  t.tick(2); await closeExpired(t.d);
  const v = (await t.d.store.getVote(2))!;
  assert.equal(v.status, "failed"); assert.equal(v.reason, "timeout");
  assert.match(t.last(), /Not accepted: <b>Val Thorens<\/b> \(2 yes, 3 needed\)/);
});

test("non-members and late joiners can't vote", async () => {
  const t = setup();
  const a = t.user(1, "A"), b = t.user(2, "B"), late = t.user(3, "Late");
  await t.say(a, "/join"); await t.say(b, "/join");
  await t.say(late, "/propose other Pizza night");
  assert.match(t.last(), /Send \/join first/);
  await t.say(a, "/propose other Pizza night");
  await t.press(late, "v:1:y");
  assert.equal(t.answers().at(-1), "Send /join in the group first.");
  t.tick(1); await t.say(late, "/join");
  await t.press(late, "v:1:y");
  assert.match(t.answers().at(-1), /joined after this vote opened/);
});

test("charter: majority adopts the rules, then /setrule changes one", async () => {
  const t = setup();
  const us = [1, 2, 3, 4].map((i) => t.user(i, "U" + i));
  for (const u of us) await t.say(u, "/join");
  await t.say(us[0], "/rules");
  assert.match(t.last(), /not agreed yet/);
  await t.say(us[0], "/charter");
  assert.match(t.last(), /Needs 3 of 4 yes \(majority\)/);
  for (const u of us.slice(0, 3)) await t.press(u, "v:1:y");
  assert.equal((await t.d.store.getChat(CHAT))!.charterAgreed, true);
  await t.say(us[0], "/charter");
  assert.match(t.last(), /already agreed/);
  await t.say(us[1], "/setrule house 75 48");
  assert.match(t.last(), /Usage/);
  await t.say(us[1], "/setrule hotel 100 2d");
  for (const u of us.slice(0, 3)) await t.press(u, "v:2:y");
  const rules = (await t.d.store.getChat(CHAT))!.rules;
  assert.deepEqual(rules.find((r) => r.type === "house"), { type: "house", label: "House / hotel", pct: 100, hours: 48 });
  await t.say(us[0], "/propose house Chalet B");
  assert.match(t.last(), /Needs 4 of 4 yes \(100%\)/);
});

test("cancel, votes list and allowed chats", async () => {
  const t = setup();
  const a = t.user(1, "A"), b = t.user(2, "B");
  await t.say(a, "/join"); await t.say(b, "/join");
  await t.say(a, "/propose dates 4–9 Mar");
  await t.say(b, "/votes");
  assert.match(t.last(), /#1 Dates: <b>4–9 Mar<\/b>/);
  await t.say(b, "/cancel 1");
  assert.match(t.last(), /Only the person who proposed it/);
  await t.say(a, "/cancel #1");
  assert.equal((await t.d.store.getVote(1))!.status, "cancelled");

  const locked = setup([555]);
  await locked.say(locked.user(1, "X"), "/join");
  assert.match(locked.last(), /Add <code>-100123<\/code> to ALLOWED_CHATS/);
  assert.equal((await locked.d.store.listMembers(CHAT)).length, 0);
});

test("titles are HTML-escaped", async () => {
  const t = setup();
  const a = t.user(1, "<b>evil</b>");
  await t.say(a, "/join");
  await t.say(a, "/propose other <script>alert(1)</script>");
  assert.ok(!t.last().includes("<script>"));
  assert.match(t.last(), /&lt;script&gt;/);
});
