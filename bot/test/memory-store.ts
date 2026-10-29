import type { Ballot, Chat, Member, Store, Vote } from "../src/store.ts";
import type { Status } from "../src/engine.ts";

export class MemoryStore implements Store {
  chats = new Map<number, Chat>(); members: Member[] = []; votes: Vote[] = []; ballots: Ballot[] = [];
  async getChat(id: number) { const c = this.chats.get(id); return c ? structuredClone(c) : null; }
  async saveChat(c: Chat) { this.chats.set(c.chatId, structuredClone(c)); }
  async addMember(m: Member) { if (this.members.some((x) => x.chatId === m.chatId && x.userId === m.userId)) return false; this.members.push(m); return true; }
  async removeMember(chatId: number, userId: number) { const n = this.members.length; this.members = this.members.filter((m) => !(m.chatId === chatId && m.userId === userId)); return this.members.length < n; }
  async getMember(chatId: number, userId: number) { return this.members.find((m) => m.chatId === chatId && m.userId === userId) ?? null; }
  async listMembers(chatId: number) { return this.members.filter((m) => m.chatId === chatId); }
  async createVote(v: Omit<Vote, "id">) { const x = { ...v, id: this.votes.length + 1 }; this.votes.push(x); return { ...x }; }
  async getVote(id: number) { const v = this.votes.find((x) => x.id === id); return v ? { ...v } : null; }
  async updateVote(v: Vote) { const i = this.votes.findIndex((x) => x.id === v.id); this.votes[i] = { ...v }; }
  async listVotes(chatId: number, status?: Status) { return this.votes.filter((v) => v.chatId === chatId && (!status || v.status === status)).map((v) => ({ ...v })); }
  async listExpired(now: number) { return this.votes.filter((v) => v.status === "open" && v.deadline <= now).map((v) => ({ ...v })); }
  async setBallot(b: Ballot) { this.ballots = this.ballots.filter((x) => !(x.voteId === b.voteId && x.userId === b.userId)); this.ballots.push(b); }
  async listBallots(voteId: number) { return this.ballots.filter((b) => b.voteId === voteId); }
}
