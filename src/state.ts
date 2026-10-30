// App state: defaults, localStorage (per viewer) and share links (the whole scenario in the URL hash).
import type { Edits, FoodPlan, Group, Ground, HouseLevel, LiftBand, PatternKey, Settings } from "./types.ts";

export interface State extends Settings {
  v: 1;
  week: number;
  limit: boolean; // always false: the transfer-time filter was removed
  dest: string[]; // resort ids; empty = all
  pick?: string;  // listing id of the house this person picks for the group
  air?: string;   // option id (resort + airport) of the flight chosen for that house; cheapest when unset
  sort: Record<string, { col: number; dir: 1 | -1 }>;
}

export const STORAGE_KEY = "snowfinder-v1";

/** Named group setups: the ones the site has houses for, with their own trips ("Trips by group"). Any other
 *  mix of couples and solo friends works too; it gets a generated id and label. */
export const GROUPS: { id: string; label: string; group: Group }[] = [
  { id: "4c1", label: "4 couples + 1 friend (living room)", group: { couples: 4, solo: 1, soloRooms: "shared", livingRoom: true } },
  { id: "4c", label: "4 couples", group: { couples: 4, solo: 0, soloRooms: "shared" } },
  { id: "3c", label: "3 couples", group: { couples: 3, solo: 0, soloRooms: "shared" } },
  { id: "4s", label: "4 friends, no couples (own rooms)", group: { couples: 0, solo: 4, soloRooms: "own" } },
  { id: "4t", label: "4 friends, no couples (sharing 2 rooms)", group: { couples: 0, solo: 4, soloRooms: "shared" } },
  { id: "4b", label: "4 friends, 4 separate beds (any rooms)", group: { couples: 0, solo: 4, soloRooms: "twin" } },
];
export const MAX_COUPLES = 8, MAX_SOLO = 8;
/** One spelling per group: rooms and sofa only matter with solo friends; old "common" is a sofa bed. */
export function normGroup(g: Partial<Group> | undefined): Group {
  const int = (x: unknown, hi: number) => { const n = Math.round(Number(x)); return Number.isFinite(n) ? Math.min(hi, Math.max(0, n)) : 0; };
  const couples = int(g?.couples, MAX_COUPLES), solo = int(g?.solo, MAX_SOLO);
  let rooms: Group["soloRooms"] = g?.soloRooms === "own" || g?.soloRooms === "twin" ? g.soloRooms : "shared";
  let livingRoom = !!g?.livingRoom || g?.soloRooms === "common";
  if (!solo) { rooms = "shared"; livingRoom = false; }
  if (livingRoom && solo === 1) rooms = "shared";
  return livingRoom ? { couples, solo, soloRooms: rooms, livingRoom } : { couples, solo, soloRooms: rooms };
}
const same = (a: Group, b: Group) => a.couples === b.couples && a.solo === b.solo && a.soloRooms === b.soloRooms && !!a.livingRoom === !!b.livingRoom;
/** A named setup's id, or a generated one ("c2s3oL": 2 couples, 3 solo, own rooms, sofa bed). */
export function groupId(g: Group): string {
  const n = normGroup(g);
  return GROUPS.find((x) => same(normGroup(x.group), n))?.id || `c${n.couples}s${n.solo}${n.soloRooms[0]}${n.livingRoom ? "L" : ""}`;
}
export function groupFromId(id: string): Group | null {
  const named = GROUPS.find((x) => x.id === id); if (named) return { ...named.group };
  const m = /^c(\d)s(\d)([sot])(L?)$/.exec(id); if (!m) return null;
  return normGroup({ couples: +m[1], solo: +m[2], soloRooms: ({ s: "shared", o: "own", t: "twin" } as const)[m[3] as "s" | "o" | "t"], livingRoom: !!m[4] });
}
/** "3 couples", or for any other mix "2 couples + 3 friends (own rooms, sofa bed)". Trip titles start with it. */
export function groupLabel(id: string): string {
  const named = GROUPS.find((x) => x.id === id); if (named) return named.label;
  const g = groupFromId(id); if (!g) return id;
  const c = g.couples ? `${g.couples} couple${g.couples > 1 ? "s" : ""}` : "", f = g.solo ? `${g.solo} friend${g.solo > 1 ? "s" : ""}` : "";
  const how = g.solo ? [g.soloRooms === "own" ? "own rooms" : g.soloRooms === "twin" ? "a bed each" : "sharing rooms", g.livingRoom ? "sofa bed" : ""].filter(Boolean).join(", ") : "";
  return [c, f].filter(Boolean).join(" + ") + (how ? ` (${how})` : "");
}

export function defaults(): State {
  return {
    v: 1, pattern: "thu", week: 0, days: 4, ground: "all", limit: false, liftBand: "10", foodPlan: "one", food: 40, beg: 0,
    group: { ...GROUPS[0].group }, house: "all", dest: [], edits: {}, sort: {},
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
  const g0 = normGroup(r.group as Partial<Group>);
  const group: Group = 2 * g0.couples + g0.solo > 0 ? g0 : { ...d.group }; // nobody going: the default group
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
    ground: oneOf(r.ground, ["car", "transfer", "all"] as const, d.ground) as Ground,
    limit: false, // the transfer-time filter was removed; old links may still carry it
    liftBand: oneOf(r.liftBand, ["all", "ski", "5", "10"] as const, d.liftBand!) as LiftBand,
    foodPlan: oneOf(r.foodPlan, ["home", "one", "both", "custom"] as const, d.foodPlan!) as FoodPlan,
    food: Math.max(0, Number.isFinite(+r.food) ? +r.food : d.food),
    beg: 0, // lessons were removed from the site; old links may still carry a number
    group,
    house: oneOf(r.house, ["all", "budget", "mid", "lux"] as const, d.house) as HouseLevel,
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
