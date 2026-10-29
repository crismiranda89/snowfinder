// Telegram update handling: commands, vote buttons and closing expired votes.
import {
  DEFAULT_RULES, META_RULE, evaluate, parseHours, parsePct, pctLabel, required, ruleFor, rulesTable, withRule,
  type Rule, type Tally,
} from "./engine.ts";
import type { Chat, Kind, Store, Vote } from "./store.ts";
import { escHtml, type Tg } from "./telegram.ts";

export interface Deps { store: Store; tg: Tg; now: () => number; tz: string; allowedChats: number[] | null; siteUrl: string }

const HOUR = 3600e3;
const HELP = (site: string, chatId: number) => `<b>Snowfinder trip votes</b>
Everyone who wants a say sends /join once. Votes need a set share of the members who had joined when the vote opened.

/join · /leave · /members
/charter: agree the group's rules (needs a majority)
/rules: show the rules
/setrule house 80 48: propose a new threshold and timeout for a vote type
/propose house &lt;name or link&gt;: open a vote (types: house, resort, dates, flights, other)
/votes: open votes · /cancel &lt;id&gt;: cancel your own vote
${site ? `\nCompare resorts and houses: ${escHtml(site)}` : ""}
<i>Chat id: <code>${chatId}</code></i>`;

// ---- helpers
async function chatOf(d: Deps, chatId: number): Promise<Chat> {
  return (await d.store.getChat(chatId)) ?? { chatId, rules: DEFAULT_RULES, charterAgreed: false };
}
function nameOf(u: any): string { return [u?.first_name, u?.last_name].filter(Boolean).join(" ") || (u?.username ? "@" + u.username : "someone"); }
function when(d: Deps, ms: number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: d.tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
}
function left(d: Deps, deadline: number): string {
  const h = Math.max(0, deadline - d.now()) / HOUR;
  return h >= 1 ? `${Math.round(h)}h left` : `${Math.max(1, Math.round(h * 60))} min left`;
}
async function tally(d: Deps, v: Vote): Promise<Tally> {
  const bs = await d.store.listBallots(v.id);
  return { yes: bs.filter((b) => b.choice === "yes").length, no: bs.filter((b) => b.choice === "no").length };
}
function voteText(d: Deps, v: Vote, t: Tally): string {
  const head = v.kind === "proposal" ? `🗳 <b>${escHtml(v.label)}</b> · vote #${v.id}` : `⚖️ <b>${escHtml(v.label)}</b> · vote #${v.id}`;
  const body = `<b>${escHtml(v.title)}</b>${v.url ? "\n" + escHtml(v.url) : ""}`;
  const rule = `Needs ${v.required} of ${v.electorate} yes (${pctLabel(v.pct)}) · proposed by ${escHtml(v.createdByName)}`;
  const status = v.status === "open"
    ? `✅ ${t.yes} · ❌ ${t.no} · closes ${when(d, v.deadline)} (${left(d, v.deadline)})`
    : v.status === "passed" ? `✅ <b>Accepted</b> with ${t.yes} yes, ${t.no} no`
    : v.status === "cancelled" ? `🚫 <b>Cancelled</b>`
    : `❌ <b>Not accepted</b> (${v.reason === "timeout" ? "time ran out" : "can no longer reach the threshold"}) · ${t.yes} yes, ${t.no} no`;
  return [head, body, rule, status].join("\n");
}
const keyboard = (v: Vote, t: Tally) => v.status !== "open" ? { inline_keyboard: [] } : {
  inline_keyboard: [[{ text: `✅ Yes (${t.yes})`, callback_data: `v:${v.id}:y` }, { text: `❌ No (${t.no})`, callback_data: `v:${v.id}:n` }]],
};
async function reply(d: Deps, chatId: number, text: string, extra: Record<string, unknown> = {}) {
  return d.tg.call("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
}

async function openVote(d: Deps, chatId: number, from: any, kind: Kind, rule: Rule, title: string, url: string | null, payload: unknown) {
  const members = await d.store.listMembers(chatId);
  if (!members.some((m) => m.userId === from.id)) return reply(d, chatId, "Send /join first so your vote counts.");
  const now = d.now();
  const v = await d.store.createVote({
    chatId, kind, type: rule.type, label: rule.label, title, url, payload: payload == null ? null : JSON.stringify(payload),
    pct: rule.pct, required: required(rule.pct, members.length), electorate: members.length,
    createdBy: from.id, createdByName: nameOf(from), createdAt: now, deadline: now + rule.hours * HOUR,
    status: "open", reason: null, messageId: null, closedAt: null,
  });
  const t = { yes: 0, no: 0 };
  const msg = await reply(d, chatId, voteText(d, v, t), { reply_markup: keyboard(v, t) });
  v.messageId = msg?.message_id ?? null;
  await d.store.updateVote(v);
  return v;
}

async function settle(d: Deps, v: Vote, cancelled = false) {
  const t = await tally(d, v);
  const r = cancelled ? { status: "cancelled" as const, reason: "cancelled" as const } : evaluate(t, v.required, v.electorate, d.now(), v.deadline);
  if (r.status === "open") return t;
  v.status = r.status; v.reason = r.reason ?? null; v.closedAt = d.now();
  await d.store.updateVote(v);
  if (v.status === "passed" && v.payload && (v.kind === "charter" || v.kind === "rule")) {
    const chat = await chatOf(d, v.chatId);
    chat.rules = JSON.parse(v.payload) as Rule[];
    chat.charterAgreed = chat.charterAgreed || v.kind === "charter";
    await d.store.saveChat(chat);
  }
  if (v.messageId) await d.tg.call("editMessageText", { chat_id: v.chatId, message_id: v.messageId, text: voteText(d, v, t), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: keyboard(v, t) }).catch(() => {});
  const outcome = v.status === "passed" ? `✅ Accepted: <b>${escHtml(v.title)}</b> (${t.yes} of ${v.electorate} said yes)`
    : v.status === "cancelled" ? `🚫 Vote #${v.id} cancelled.`
    : `❌ Not accepted: <b>${escHtml(v.title)}</b> (${t.yes} yes, ${v.required} needed)`;
  await reply(d, v.chatId, outcome + (v.status === "passed" && v.kind !== "proposal" ? "\nThe group's rules are updated. /rules" : ""), v.messageId ? { reply_to_message_id: v.messageId } : {});
  return t;
}

// ---- commands
async function onCommand(d: Deps, msg: any, cmd: string, args: string) {
  const chatId: number = msg.chat.id, from = msg.from;
  switch (cmd) {
    case "start": case "help":
      return reply(d, chatId, HELP(d.siteUrl, chatId));
    case "join": {
      const added = await d.store.addMember({ chatId, userId: from.id, name: nameOf(from), joinedAt: d.now() });
      const n = (await d.store.listMembers(chatId)).length;
      return reply(d, chatId, added ? `👋 ${escHtml(nameOf(from))} joined. ${n} ${n === 1 ? "member" : "members"} can vote.` : `You're already in (${n} members).`);
    }
    case "leave": {
      const gone = await d.store.removeMember(chatId, from.id);
      return reply(d, chatId, gone ? `${escHtml(nameOf(from))} left the votes. Open votes keep their original threshold.` : "You weren't a member.");
    }
    case "members": {
      const ms = await d.store.listMembers(chatId);
      return reply(d, chatId, ms.length ? `<b>${ms.length} members</b>\n` + ms.map((m) => "• " + escHtml(m.name)).join("\n") : "Nobody has joined yet. Send /join.");
    }
    case "rules": {
      const c = await chatOf(d, chatId);
      return reply(d, chatId, `<b>${c.charterAgreed ? "Agreed rules" : "Proposed rules (not agreed yet, run /charter)"}</b>\n${rulesTable(c.rules)}\nChanging a rule: ${pctLabel(META_RULE.pct)} within ${META_RULE.hours}h.`);
    }
    case "charter": {
      const c = await chatOf(d, chatId);
      if (c.charterAgreed) return reply(d, chatId, "The rules are already agreed. Use /setrule to change one, e.g. <code>/setrule house 80 48</code>.");
      if ((await d.store.listVotes(chatId, "open")).some((v) => v.kind === "charter")) return reply(d, chatId, "A charter vote is already open. /votes");
      return openVote(d, chatId, from, "charter", META_RULE, "Adopt these rules:\n" + rulesTable(c.rules).replace(/<\/?code>/g, ""), null, c.rules);
    }
    case "setrule": {
      const [typeWord, pctS, hoursS] = args.split(/\s+/);
      const c = await chatOf(d, chatId);
      const rule = ruleFor(c.rules, typeWord);
      const pct = pctS ? parsePct(pctS) : null, hours = hoursS ? parseHours(hoursS) : null;
      if (!rule || pct == null || hours == null)
        return reply(d, chatId, `Usage: <code>/setrule &lt;type&gt; &lt;50-100 in steps of 10, or majority&gt; &lt;hours, or 2d&gt;</code>\nTypes: ${c.rules.map((r) => r.type).join(", ")}`);
      const next = withRule(c.rules, { ...rule, pct, hours });
      return openVote(d, chatId, from, "rule", META_RULE, `${rule.label}: ${pctLabel(rule.pct)}/${rule.hours}h → ${pctLabel(pct)}/${hours}h`, null, next);
    }
    case "propose": {
      const c = await chatOf(d, chatId);
      const [first, ...rest] = args.split(/\s+/);
      let rule = ruleFor(c.rules, first), text = rest.join(" ").trim();
      if (!rule) { rule = ruleFor(c.rules, "other")!; text = args.trim(); }
      if (!text) return reply(d, chatId, "Usage: <code>/propose house Apartaments Superior El Tarter https://…</code>");
      const url = /https?:\/\/\S+/.exec(text)?.[0] ?? null;
      const title = (url ? text.replace(url, "") : text).trim() || url!;
      return openVote(d, chatId, from, "proposal", rule, title.slice(0, 200), url, null);
    }
    case "votes": {
      const open = await d.store.listVotes(chatId, "open");
      if (!open.length) return reply(d, chatId, "No open votes.");
      const lines = await Promise.all(open.map(async (v) => { const t = await tally(d, v); return `#${v.id} ${escHtml(v.label)}: <b>${escHtml(v.title.split("\n")[0])}</b>\n   ✅ ${t.yes}/${v.required} needed · ❌ ${t.no} · ${left(d, v.deadline)}`; }));
      return reply(d, chatId, lines.join("\n"));
    }
    case "cancel": {
      const v = await d.store.getVote(Number(args.replace("#", "")));
      if (!v || v.chatId !== chatId || v.status !== "open") return reply(d, chatId, "No open vote with that number. /votes");
      if (v.createdBy !== from.id) return reply(d, chatId, "Only the person who proposed it can cancel it.");
      return settle(d, v, true);
    }
  }
}

async function onButton(d: Deps, q: any) {
  const m = /^v:(\d+):([yn])$/.exec(q.data || "");
  const answer = (text: string) => d.tg.call("answerCallbackQuery", { callback_query_id: q.id, text });
  if (!m) return answer("Unknown button");
  const v = await d.store.getVote(Number(m[1]));
  if (!v || v.status !== "open") return answer("This vote is closed.");
  const member = await d.store.getMember(v.chatId, q.from.id);
  if (!member) return answer("Send /join in the group first.");
  if (member.joinedAt > v.createdAt) return answer("You joined after this vote opened, so it isn't counted.");
  await d.store.setBallot({ voteId: v.id, userId: q.from.id, choice: m[2] === "y" ? "yes" : "no", at: d.now() });
  const t = await settle(d, v);
  if (v.status === "open" && v.messageId) await d.tg.call("editMessageText", { chat_id: v.chatId, message_id: v.messageId, text: voteText(d, v, t), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: keyboard(v, t) }).catch(() => {});
  return answer(m[2] === "y" ? "Voted yes ✅" : "Voted no ❌");
}

export async function handleUpdate(update: any, d: Deps) {
  const msg = update.message, q = update.callback_query;
  const chatId: number | undefined = msg?.chat?.id ?? q?.message?.chat?.id;
  if (chatId == null) return;
  if (d.allowedChats && !d.allowedChats.includes(chatId)) {
    if (msg?.text?.startsWith("/")) await reply(d, chatId, `This bot isn't enabled for this chat. Add <code>${chatId}</code> to ALLOWED_CHATS.`);
    return;
  }
  if (q) return onButton(d, q);
  const cm = /^\/([a-z]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(msg?.text || "");
  if (cm) return onCommand(d, msg, cm[1].toLowerCase(), (cm[2] || "").trim());
}

/** Cron: close every vote whose deadline has passed. */
export async function closeExpired(d: Deps) {
  for (const v of await d.store.listExpired(d.now())) await settle(d, v);
}
