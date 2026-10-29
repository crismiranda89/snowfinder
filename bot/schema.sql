-- Snowfinder vote bot · Cloudflare D1 schema. Apply with:
--   npx wrangler d1 execute snowfinder-bot --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS chats (
  chat_id        INTEGER PRIMARY KEY,
  rules          TEXT    NOT NULL,            -- JSON array of {type,label,pct,hours}
  charter_agreed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS members (
  chat_id   INTEGER NOT NULL,
  user_id   INTEGER NOT NULL,
  name      TEXT    NOT NULL,
  joined_at INTEGER NOT NULL,                 -- ms since epoch
  PRIMARY KEY (chat_id, user_id)
);
CREATE TABLE IF NOT EXISTS votes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id         INTEGER NOT NULL,
  kind            TEXT    NOT NULL,           -- proposal | charter | rule
  type            TEXT    NOT NULL,
  label           TEXT    NOT NULL,
  title           TEXT    NOT NULL,
  url             TEXT,
  payload         TEXT,
  pct             INTEGER NOT NULL,
  required        INTEGER NOT NULL,
  electorate      INTEGER NOT NULL,
  created_by      INTEGER NOT NULL,
  created_by_name TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,
  deadline        INTEGER NOT NULL,
  status          TEXT    NOT NULL,           -- open | passed | failed | cancelled
  reason          TEXT,
  message_id      INTEGER,
  closed_at       INTEGER
);
CREATE INDEX IF NOT EXISTS votes_open ON votes (status, deadline);
CREATE TABLE IF NOT EXISTS ballots (
  vote_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  choice  TEXT    NOT NULL,                   -- yes | no
  at      INTEGER NOT NULL,
  PRIMARY KEY (vote_id, user_id)
);
