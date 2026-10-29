// App state: defaults, localStorage (per viewer) and share links (the whole scenario in the URL hash).
import type { Edits, FoodPlan, Group, Ground, PatternKey, Settings, Tier } from "./types.ts";

export interface State extends Settings {
  v: 1;
  week: number;
  limit: boolean;
  dest: string[]; // resort ids; empty = all
  pick?: string;  // listing id of the house this person picks for the group
  air?: string;   // option id (resort + airport) of the flight chosen for that house; cheapest when unset
  sort: Record<string, { col: number; dir: 1 | -1 }>;
}

export const STORAGE_KEY = "snowfinder-v1";

/** The group setups the site has houses for. Anything else (an old link, a hand-edited one) falls back to the first. */
export const GROUPS: { id: string; label: string; group: Group }[] = [
  { id: "4c1", label: "4 couples + 1 friend (living room)", group: { couples: 4, solo: 1, soloRooms: "common" } },
  { id: "4c", label: "4 couples", group: { couples: 4, solo: 0, soloRooms: "common" } },
  { id: "3c", label: "3 couples", group: { couples: 3, solo: 0, soloRooms: "common" } },
  { id: "4s", label: "4 friends, no couples (own rooms)", group: { couples: 0, solo: 4, soloRooms: "own" } },
  { id: "4t", label: "4 friends, no couples (sharing 2 rooms)", group: { couples: 0, solo: 4, soloRooms: "shared" } },
  { id: "4b", label: "4 friends, 4 separate beds (2 rooms)", group: { couples: 0, solo: 4, soloRooms: "twin" } },
];
export const groupId = (g: Group) => (GROUPS.find((x) => x.group.couples === g.couples && x.group.solo === g.solo && x.group.soloRooms === g.soloRooms)
  || GROUPS.find((x) => x.group.couples === g.couples && x.group.solo === g.solo))?.id || GROUPS[0].id;

export function defaults(): State {
  return {
    v: 1, pattern: "thu", week: 0, days: 4, ground: "car", limit: false, nearLifts: true, foodPlan: "home", food: 40, beg: 0,
    group: { ...GROUPS[0].group }, house: "mid", dest: [], edits: {}, sort: {},
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
  const group: Group = { ...GROUPS.find((x) => x.id === groupId({ couples: +g.couples! || 0, solo: +g.solo! || 0, soloRooms: g.soloRooms as Group["soloRooms"] }))!.group };
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
    nearLifts: typeof r.nearLifts === "boolean" ? r.nearLifts : !!d.nearLifts,
    foodPlan: oneOf(r.foodPlan, ["home", "one", "both", "custom"] as const, d.foodPlan!) as FoodPlan,
    food: Math.max(0, Number.isFinite(+r.food) ? +r.food : d.food),
    beg: 0, // lessons were removed from the site; old links may still carry a number
    group,
    house: oneOf(r.house, ["budget", "mid", "lux"] as const, "mid") as Tier,
    dest: Array.isArray(r.dest) ? r.dest.filter((x: unknown) => typeof x === "string") : [],
    edits,
    sort: r.sort && typeof r.sort === "object" ? r.sort : {},
    pick: typeof r.pick === "string" && /^[\w-]{1,40}$/.test(r.pick) ? r.pick : undefined,
    air: typeof r.air === "string" && /^[\w-]{1,40}$/.test(r.air) ? r.air : undefined,
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
