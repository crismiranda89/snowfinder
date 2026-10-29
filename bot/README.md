# Snowfinder vote bot (Telegram)

A Telegram bot that runs the group's decisions: which house, which resort, which dates. Each kind of
decision needs a set share of the group and has a deadline. The group agrees those rules by majority at
the planning meeting.

## How votes work

- Everyone who wants a say sends **/join** once. One person, one vote.
- Each vote type has a **threshold** (round numbers: 50–100% in steps of 10, or "majority") and a **timeout**.
  The yes votes needed are fixed when the vote opens, from the members at that moment:
  80% of 5 people = **4 yes**, 80% of 9 = 8, majority of 9 = 5.
- A vote **passes** as soon as it gets enough yes. It **fails early** once enough people have said no that
  it can't pass any more. Otherwise it's decided **at the deadline**.
- People can change their vote while it's open. People who join after a vote opened don't count for it.

Default rules, proposed to the group by `/charter`:

| Type | Threshold | Timeout |
|---|---|---|
| `house` (also: hotel, apartment, chalet) | 80% | 48h |
| `resort` | 60% | 72h |
| `dates` | 80% | 48h |
| `flights` | 60% | 24h |
| `other` | majority | 24h |

Agreeing the charter, or changing a rule with `/setrule house 80 48`, always needs a majority within 24h.

## Commands

```
/join  /leave  /members
/charter                      agree the rules
/rules                        show them
/setrule <type> <pct|majority> <hours|Nd>
/propose <type> <title or link>
/votes                        open votes
/cancel <id>                  cancel your own vote
```

Example: `/propose house Apartaments Superior El Tarter https://www.booking.com/hotel/ad/apartamentos-superior-el-tarter.html`

## Set it up (about 15 minutes, free)

You need a [Cloudflare](https://dash.cloudflare.com/sign-up) account and Node 22.

1. In Telegram, talk to **@BotFather** → `/newbot` → copy the **token**.
2. Install and log in:
   ```bash
   cd bot
   npm install
   npx wrangler login
   ```
3. Create the database and paste the `database_id` it prints into `wrangler.toml`:
   ```bash
   npx wrangler d1 create snowfinder-bot
   npm run db:init
   ```
4. Add the secrets (the webhook secret is any long random string, e.g. from `openssl rand -hex 32`):
   ```bash
   npx wrangler secret put BOT_TOKEN
   npx wrangler secret put WEBHOOK_SECRET
   ```
5. Deploy. It prints your URL, like `https://snowfinder-bot.<you>.workers.dev`:
   ```bash
   npm run deploy
   ```
6. Point Telegram at it (replace the three values):
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url=https://snowfinder-bot.<you>.workers.dev/telegram \
     -d secret_token=<WEBHOOK_SECRET> \
     -d 'allowed_updates=["message","callback_query"]'
   ```
7. Add the bot to your trip group and send `/help`.
8. Recommended: lock the bot to your group. `/help` shows the group's chat id; put it in `ALLOWED_CHATS`
   in `wrangler.toml` and deploy again. The bot then ignores other chats, apart from telling them their id.

At the planning meeting: everyone sends `/join`, then someone sends `/charter` and the group votes.

To deploy from GitHub instead, set the repository variable `DEPLOY_BOT=true` and the secrets
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The *Deploy bot* workflow then runs on every change
to `bot/`.

## How it runs

- `src/index.ts`: the Worker. `POST /telegram` receives updates (it checks Telegram's secret-token header),
  and a cron every 15 minutes closes expired votes.
- `src/engine.ts`: thresholds and outcomes, pure and unit-tested.
- `src/bot.ts`: commands and buttons. `src/store.ts`: D1 storage (`schema.sql`).
- `npm test` runs everything against an in-memory store and a fake Telegram API.

Bots in groups only see commands and their own buttons (Telegram privacy mode), which is all this bot needs.
