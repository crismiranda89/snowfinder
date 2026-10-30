// Curated house listings → Budget / Mid / Luxury tiers for the current group and week.
// Each listing has one or more price quotes for specific dates. To price it in another week, each quote's
// nightly price is divided by the stay multiplier of its own week (a "normal-week" price), the median of
// those is taken, and it is multiplied by the target week's multiplier.
import type { Group, HouseLevel, LiftBand, Listing, Quote, Season, Tier } from "../types.ts";
import { level, weekOfStay } from "./calendar.ts";
import { bedrooms, people, sofa } from "./group.ts";

export const TIERS: Tier[] = ["budget", "mid", "lux"];
export const TIER_LABEL: Record<Tier, string> = { budget: "Budget", mid: "Mid", lux: "Luxury" };
/** A house counts for the group if it has enough beds and between the needed bedrooms and this many more. */
export const MAX_EXTRA_BEDROOMS = 2;
/** Walking pace to the lifts in ski boots, metres per minute (a listing's "900 m, about 12 minutes"). */
export const WALK_M_PER_MIN = 75;
/** "Near the lifts" means at most this many minutes' walk. */
export const NEAR_LIFT_MIN = 10;
export const walkMins = (m: number) => Math.max(1, Math.round(m / WALK_M_PER_MIN));
/** Listings with a known distance within NEAR_LIFT_MIN minutes' walk. Unknown distance doesn't count. */
export const nearLifts = (l: Listing) => l.toLiftM != null && walkMins(l.toLiftM) <= NEAR_LIFT_MIN;
/** The lift-distance bands, the same as the Houses section's "By distance to lifts" groups (metres). */
export const LIFT_BANDS: Record<LiftBand, { max: number; label: string; text: string }> = {
  all: { max: Infinity, label: "All", text: "" },
  ski: { max: 100, label: "Ski in / ski out", text: "ski in / ski out" },
  "5": { max: 375, label: "Up to 5 min", text: "within a 5-min walk of the lifts" },
  "10": { max: 750, label: "Up to 10 min", text: "within a 10-min walk of the lifts" },
};
/** A listing inside the band; with a band set, an unknown distance doesn't count. */
export const inBand = (l: Listing, band: LiftBand = "all") => band === "all" || (l.toLiftM != null && l.toLiftM <= LIFT_BANDS[band].max);
export const LEVEL_LABEL: Record<HouseLevel, string> = { all: "Any", budget: "Budget", mid: "Mid", lux: "Luxury" };

export interface Priced { l: Listing; total: number; pp: number; exact: boolean; quote: Quote }
export interface TierResult { tier: Tier; listings: Priced[]; median: number; medianPP: number; pick: Priced }
export interface HouseResult {
  mode: "tiers" | "few" | "none";
  eligible: Priced[];
  tiers: TierResult[];
  bedrooms: number;
  people: number;
  total: number; // listings for the resort before the size filter
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function fits(l: Listing, g: Group): boolean {
  const b = bedrooms(g);
  // Twin: everyone needs a bed of their own, in any room: the listing must say it has enough beds, or have a
  // bedroom each. Any number of bedrooms up to one per person.
  if (g.soloRooms === "twin") { const beds = people(g) - sofa(g); return ((l.beds ?? 0) >= beds || l.bedrooms >= beds) && l.sleeps >= people(g) && l.bedrooms <= Math.max(b + MAX_EXTRA_BEDROOMS, people(g)); }
  return l.sleeps >= people(g) && l.bedrooms >= b && l.bedrooms <= b + MAX_EXTRA_BEDROOMS;
}

export function priceFor(season: Season, market: string, l: Listing, w: number, n = season.nights): { total: number; exact: boolean; quote: Quote } {
  const weeks = l.quotes.map((q) => weekOfStay(season, q.checkin, q.checkout));
  const hit = l.quotes.findIndex((q, i) => weeks[i] === w && q.nights === n);
  if (hit >= 0) return { total: l.quotes[hit].total, exact: true, quote: l.quotes[hit] };
  const normal = l.quotes.map((q, i) => q.total / q.nights / (weeks[i] >= 0 ? season.multipliers.stay[level(season, market, weeks[i])] : 1));
  const to = season.multipliers.stay[level(season, market, w)];
  const nearest = l.quotes.map((q, i) => ({ q, d: weeks[i] < 0 ? 99 : Math.abs(weeks[i] - w) })).sort((a, b) => a.d - b.d)[0].q;
  return { total: Math.round(median(normal) * to * n), exact: false, quote: nearest };
}

/** Best pick inside a tier: highest rating, then nearest the lifts, then cheapest. */
export function bestPick(xs: Priced[]): Priced {
  return [...xs].sort((a, b) =>
    (b.l.rating ?? -1) - (a.l.rating ?? -1) ||
    (a.l.toLiftM ?? Infinity) - (b.l.toLiftM ?? Infinity) ||
    a.total - b.total)[0];
}

export function houses(season: Season, market: string, listings: Listing[], g: Group, w: number, band: LiftBand = "all", nights = season.nights): HouseResult {
  const p = people(g);
  const eligible = listings.filter((l) => fits(l, g) && inBand(l, band)).map((l) => {
    const pr = priceFor(season, market, l, w, nights);
    return { l, total: pr.total, pp: pr.total / p, exact: pr.exact, quote: pr.quote };
  }).sort((a, b) => a.total - b.total);
  const base = { eligible, bedrooms: bedrooms(g), people: p, total: listings.length };
  if (!eligible.length) return { ...base, mode: "none", tiers: [] };
  if (eligible.length < 3) return { ...base, mode: "few", tiers: [] };
  const n = eligible.length;
  const tiers: TierResult[] = TIERS.map((tier, t) => {
    const xs = eligible.filter((_, i) => Math.floor((3 * i) / n) === t);
    const med = median(xs.map((x) => x.total));
    return { tier, listings: xs, median: med, medianPP: med / p, pick: bestPick(xs) };
  });
  return { ...base, mode: "tiers", tiers };
}

/** Group stay cost implied by the houses for a chosen level ("all": every fitting house), or null when none fit. */
export function stayFromHouses(h: HouseResult, tier: HouseLevel): number | null {
  if (h.mode === "tiers" && tier !== "all") return h.tiers.find((t) => t.tier === tier)!.median;
  if (h.mode !== "none") return median(h.eligible.map((x) => x.total));
  return null;
}
