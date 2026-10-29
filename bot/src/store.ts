// Persistence. D1Store is used in production; tests use MemoryStore (test/memory-store.ts).
import type { Rule, Status } from "./engine.ts";

export interface Chat { chatId: number; rules: Rule[]; charterAgreed: boolean }
export interface Member { chatId: number; userId: number; name: string; joinedAt: number }
export type Kind = "proposal" | "charter" | "rule";
export interface Vote {
  id: number; chatId: number; kind: Kind; type: string; label: string; title: string; url: string | null;
  payload: string | null; // JSON: the rules a charter/rule vote would set
  pct: number; required: number; electorate: number;
  createdBy: number; createdByName: string; createdAt: number; deadline: number;
  status: Status; reason: string | null; messageId: number | null; closedAt: number | null;
}
export interface Ballot { voteId: number; userId: number; choice: "yes" | "no"; at: number }

export interface Store {
  getChat(chatId: number): Promise<Chat | null>;
  saveChat(c: Chat): Promise<void>;
  addMember(m: Member): Promise<boolean>; // false if already a member
  removeMember(chatId: number, userId: number): Promise<boolean>;
  getMember(chatId: number, userId: number): Promise<Member | null>;
  listMembers(chatId: number): Promise<Member[]>;
  createVote(v: Omit<Vote, "id">): Promise<Vote>;
  getVote(id: number): Promise<Vote | null>;
  updateVote(v: Vote): Promise<void>;
  listVotes(chatId: number, status?: Status): Promise<Vote[]>;
  listExpired(now: number): Promise<Vote[]>;
  setBallot(b: Ballot): Promise<void>;
  listBallots(voteId: number): Promise<Ballot[]>;
}

// Minimal D1 types so the bot doesn't need @cloudflare/workers-types to type-check.
export interface D1Result<T> { results: T[] }
export interface D1Prepared { bind(...v: unknown[]): D1Prepared; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<D1Result<T>>; run(): Promise<{ meta: { last_row_id?: number; changes?: number } }> }
export interface D1Database { prepare(sql: string): D1Prepared }

type Row = Record<string, any>;
const toVote = (r: Row): Vote => ({
  id: r.id, chatId: r.chat_id, kind: r.kind, type: r.type, label: r.label, title: r.title, url: r.url, payload: r.payload,
  pct: r.pct, required: r.required, electorate: r.electorate, createdBy: r.created_by, createdByName: r.created_by_name,
  createdAt: r.created_at, deadline: r.deadline, status: r.status, reason: r.reason, messageId: r.message_id, closedAt: r.closed_at,
});

export class D1Store implements Store {
  private db: D1Database;
  constructor(db: D1Database) { this.db = db; }
  async getChat(chatId: number) {
    const r = await this.db.prepare("SELECT * FROM chats WHERE chat_id = ?").bind(chatId).first<Row>();
    return r ? { chatId: r.chat_id, rules: JSON.parse(r.rules), charterAgreed: !!r.charter_agreed } : null;
  }
  async saveChat(c: Chat) {
    await this.db.prepare("INSERT INTO chats (chat_id, rules, charter_agreed) VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET rules = excluded.rules, charter_agreed = excluded.charter_agreed")
      .bind(c.chatId, JSON.stringify(c.rules), c.charterAgreed ? 1 : 0).run();
  }
  async addMember(m: Member) {
    const r = await this.db.prepare("INSERT OR IGNORE INTO members (chat_id, user_id, name, joined_at) VALUES (?, ?, ?, ?)").bind(m.chatId, m.userId, m.name, m.joinedAt).run();
    return (r.meta.changes ?? 0) > 0;
  }
  async removeMember(chatId: number, userId: number) {
    const r = await this.db.prepare("DELETE FROM members WHERE chat_id = ? AND user_id = ?").bind(chatId, userId).run();
    return (r.meta.changes ?? 0) > 0;
  }
  async getMember(chatId: number, userId: number) {
    const r = await this.db.prepare("SELECT * FROM members WHERE chat_id = ? AND user_id = ?").bind(chatId, userId).first<Row>();
    return r ? { chatId: r.chat_id, userId: r.user_id, name: r.name, joinedAt: r.joined_at } : null;
  }
  async listMembers(chatId: number) {
    const { results } = await this.db.prepare("SELECT * FROM members WHERE chat_id = ? ORDER BY joined_at").bind(chatId).all<Row>();
    return results.map((r) => ({ chatId: r.chat_id, userId: r.user_id, name: r.name, joinedAt: r.joined_at }));
  }
  async createVote(v: Omit<Vote, "id">) {
    const r = await this.db.prepare(`INSERT INTO votes (chat_id, kind, type, label, title, url, payload, pct, required, electorate, created_by, created_by_name, created_at, deadline, status, reason, message_id, closed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(v.chatId, v.kind, v.type, v.label, v.title, v.url, v.payload, v.pct, v.required, v.electorate, v.createdBy, v.createdByName, v.createdAt, v.deadline, v.status, v.reason, v.messageId, v.closedAt).run();
    return { ...v, id: Number(r.meta.last_row_id) };
  }
  async getVote(id: number) {
    const r = await this.db.prepare("SELECT * FROM votes WHERE id = ?").bind(id).first<Row>();
    return r ? toVote(r) : null;
  }
  async updateVote(v: Vote) {
    await this.db.prepare("UPDATE votes SET status = ?, reason = ?, message_id = ?, closed_at = ? WHERE id = ?").bind(v.status, v.reason, v.messageId, v.closedAt, v.id).run();
  }
  async listVotes(chatId: number, status?: Status) {
    const q = status ? this.db.prepare("SELECT * FROM votes WHERE chat_id = ? AND status = ? ORDER BY id").bind(chatId, status)
      : this.db.prepare("SELECT * FROM votes WHERE chat_id = ? ORDER BY id").bind(chatId);
    return (await q.all<Row>()).results.map(toVote);
  }
  async listExpired(now: number) {
    return (await this.db.prepare("SELECT * FROM votes WHERE status = 'open' AND deadline <= ?").bind(now).all<Row>()).results.map(toVote);
  }
  async setBallot(b: Ballot) {
    await this.db.prepare("INSERT INTO ballots (vote_id, user_id, choice, at) VALUES (?, ?, ?, ?) ON CONFLICT(vote_id, user_id) DO UPDATE SET choice = excluded.choice, at = excluded.at")
      .bind(b.voteId, b.userId, b.choice, b.at).run();
  }
  async listBallots(voteId: number) {
    const { results } = await this.db.prepare("SELECT * FROM ballots WHERE vote_id = ?").bind(voteId).all<Row>();
    return results.map((r) => ({ voteId: r.vote_id, userId: r.user_id, choice: r.choice, at: r.at }));
  }
}
