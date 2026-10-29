// Cloudflare Worker entry: Telegram webhook (POST /telegram) and the cron that closes expired votes.
import { closeExpired, handleUpdate, type Deps } from "./bot.ts";
import { D1Store, type D1Database } from "./store.ts";
import { telegram } from "./telegram.ts";

export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;        // secret: from @BotFather
  WEBHOOK_SECRET: string;   // secret: any long random string, also given to setWebhook
  ALLOWED_CHATS?: string;   // comma-separated chat ids; empty = any chat
  TIMEZONE?: string;        // for deadlines shown in chat, default Europe/Lisbon
  SITE_URL?: string;        // link to the Snowfinder site shown in /help
}

function deps(env: Env): Deps {
  const allowed = (env.ALLOWED_CHATS || "").split(",").map((s) => s.trim()).filter(Boolean).map(Number);
  return { store: new D1Store(env.DB), tg: telegram(env.BOT_TOKEN), now: () => Date.now(), tz: env.TIMEZONE || "Europe/Lisbon", allowedChats: allowed.length ? allowed : null, siteUrl: env.SITE_URL || "" };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method !== "POST" || url.pathname !== "/telegram") return new Response("Snowfinder vote bot is running.");
    if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
    try { await handleUpdate(await req.json(), deps(env)); } catch (e) { console.error(e); }
    return new Response("ok"); // always 200, so Telegram doesn't retry the same update forever
  },
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(closeExpired(deps(env)));
  },
};
