// Cost model, ported 1:1 from the original simulator (baseVal / val / calc) with the fixed group of 4
// replaced by the group's size. For 2 couples and no house listings it reproduces the original exactly
// (tests/golden.test.ts).
import type { Field, FoodPlan, Listing, Option, Season, Settings } from "../types.ts";
import { foodDays, level, nights } from "./calendar.ts";
import { bedrooms, cars, people, transferFactor } from "./group.ts";
import { houses, stayFromHouses, type HouseResult } from "./houses.ts";

export const FIELDS: Field[] = ["flight", "car", "transfer", "stay", "pass4", "pass5", "rent4", "rent5", "lesson"];
export const STAY_SCALE = 0.9; // a 4-bedroom place costs ~1.87× a 2-bedroom one, not 2×

export function baseVal(season: Season, d: Option, f: Field, w: number): number {
  const L = level(season, d.mkt, w), v = d[f], M = season.multipliers;
  if (f === "stay") return v * M.stay[L];
  if (f === "flight") return v * M.flight[L];
  if (f === "car" || f === "transfer") return v * M.ground[L];
  if (d.dynPass && (f === "pass4" || f === "pass5")) return v * M.dynPass[L];
  return v;
}
export function edited(s: Settings, d: Option, f: Field, w: number): number | null {
  const e = s.edits[d.id + "@" + w];
  return e && e[f] != null ? e[f]! : null;
}
export function val(season: Season, s: Settings, d: Option, f: Field, w: number): number {
  const e = edited(s, d, f, w);
  return e != null ? e : Math.round(baseVal(season, d, f, w));
}

export function stayEstimate(season: Season, s: Settings, d: Option, w: number): number {
  // The seasonal stay price is for season.nights; a 5th ski day adds a night.
  return Math.round(baseVal(season, d, "stay", w) * Math.pow(bedrooms(s.group) / season.baseBedrooms, STAY_SCALE) * nights(season, s.days) / season.nights);
}

export interface StayInfo { total: number; source: "edited" | "houses" | "few" | "estimate"; houses: HouseResult }
export function stay(season: Season, s: Settings, d: Option, w: number, listings: Listing[]): StayInfo {
  const h = houses(season, d.mkt, listings, s.group, w, !!s.nearLifts, nights(season, s.days));
  const e = edited(s, d, "stay", w);
  if (e != null) return { total: e, source: "edited", houses: h };
  const fromHouses = stayFromHouses(h, s.house);
  if (fromHouses != null) return { total: Math.round(fromHouses), source: h.mode === "tiers" ? "houses" : "few", houses: h };
  return { total: stayEstimate(season, s, d, w), source: "estimate", houses: h };
}

/** Food per person per day as a multiple of the resort's meal-out price; the fraction on top of the meals
 *  out is groceries for the meals cooked at home and slope snacks. */
export const FOOD_PLANS: Record<Exclude<FoodPlan, "custom">, { label: string; meals: number }> = {
  home: { label: "Cook at home + snacks", meals: 0.6 },  // groceries for every meal + a snack
  one: { label: "One meal out a day", meals: 1.4 },      // 1 meal out + groceries for the rest
  both: { label: "Lunch and dinner out", meals: 2.2 },   // 2 meals out + breakfast and snacks
};
export function foodPerDay(s: Settings, d: Option): number {
  const p = s.foodPlan && s.foodPlan !== "custom" ? FOOD_PLANS[s.foodPlan] : null;
  return p ? Math.round(p.meals * d.meal) : (+s.food || 0);
}

export interface Parts { flight: number; ground: number; stay: number; pass: number; rent: number; food: number; lesson: number }
export interface Calc { parts: Parts; pp: number; group: number; people: number; stayTotal: number; groundTotal: number; stay: StayInfo }

export function calc(season: Season, s: Settings, d: Option, w: number, listings: Listing[] = []): Calc {
  const p = people(s.group);
  const groundTotal = s.ground === "car" ? val(season, s, d, "car", w) * cars(p) : val(season, s, d, "transfer", w) * transferFactor(p);
  const st = stay(season, s, d, w, listings);
  const parts: Parts = {
    flight: val(season, s, d, "flight", w),
    ground: groundTotal / p,
    stay: st.total / p,
    pass: val(season, s, d, ("pass" + s.days) as Field, w),
    rent: val(season, s, d, ("rent" + s.days) as Field, w),
    food: foodPerDay(s, d) * foodDays(season, s.days),
    lesson: val(season, s, d, "lesson", w) * s.days * (+s.beg || 0) / p,
  };
  const pp = parts.flight + parts.ground + parts.stay + parts.pass + parts.rent + parts.food + parts.lesson;
  return { parts, pp, group: pp * p, people: p, stayTotal: st.total, groundTotal, stay: st };
}
