// App state: defaults, localStorage (per viewer) and share links (the whole scenario in the URL hash).
import type { Edits, Group, Ground, PatternKey, Settings, Tier } from "./types.ts";

export interface State extends Settings {
  v: 1;
  week: number;
  limit: boolean;
  dest: string[]; // resort ids; empty = all
  sort: Record<string, { col: number; dir: 1 | -1 }>;
}

export const STORAGE_KEY = "snowfinder-v1";

export function defaults(): State {
  return {
    v: 1, pattern: "thu", week: 0, days: 4, ground: "car", limit: false, food: 40, beg: 2,
    group: { couples: 2, solo: 0, soloRooms: "shared" }, house: "mid", dest: [], edits: {}, sort: {},
  };
}

const int = (x: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(x));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const oneOf = <T extends string>(x: unknown, xs: readonly T[], d: T): T => (xs as readonly string[]).includes(x as string) ? (x as T) : d;

/** Accepts anything (old localStorage, a hand-edited link) and returns a valid state. */
export function sanitize(raw: unknown, weeks: number): State {
  const d = defaults();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, any>;
  const g = (r.group || {}) as Partial<Group>;
  const group: Group = {
    couples: int(g.couples, 0, 20, d.group.couples),
    solo: int(g.solo, 0, 20, d.group.solo),
    soloRooms: oneOf(g.soloRooms, ["shared", "own", "common"] as const, "shared"),
  };
  if (group.couples === 0 && group.solo === 0) group.solo = 1;
  const people = 2 * group.couples + group.solo;
  const edits: Edits = {};
  if (r.edits && typeof r.edits === "object") {
    for (const [k, v] of Object.entries(r.edits)) {
      if (!/^[\w-]+@\d+$/.test(k) || !v || typeof v !== "object") continue;
      const clean: Record<string, number> = {};
      for (const [f, n] of Object.entries(v as object)) if (Number.isFinite(+n) && +n >= 0) clean[f] = +n;
      edits[k] = clean;
    }
  }
  return {
    v: 1,
    pattern: oneOf(r.pattern, ["wed", "thu", "fri"] as const, d.pattern) as PatternKey,
    week: int(r.week, 0, weeks - 1, 0),
    days: int(r.days, 4, 5, 4) as 4 | 5,
    ground: oneOf(r.ground, ["car", "transfer"] as const, "car") as Ground,
    limit: !!r.limit,
    food: Math.max(0, Number.isFinite(+r.food) ? +r.food : d.food),
    beg: int(r.beg, 0, people, Math.min(d.beg, people)),
    group,
    house: oneOf(r.house, ["budget", "mid", "lux"] as const, "mid") as Tier,
    dest: Array.isArray(r.dest) ? r.dest.filter((x: unknown) => typeof x === "string") : [],
    edits,
    sort: r.sort && typeof r.sort === "object" ? r.sort : {},
  };
}

export function load(weeks: number): State {
  try { return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"), weeks); } catch { return defaults(); }
}
export function save(s: State): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* private mode etc. */ }
}

// ---- share links: #s=<base64url(JSON)>
function b64url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
export function encodeShare(s: State): string {
  const { sort: _sort, ...rest } = s;
  return "s=" + b64url(JSON.stringify(rest));
}
export function decodeShare(hash: string, weeks: number): State | null {
  const m = /(?:^#?|&)s=([\w-]+)/.exec(hash);
  if (!m) return null;
  try { return sanitize(JSON.parse(unb64url(m[1])), weeks); } catch { return null; }
}
