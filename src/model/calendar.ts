// Dates, demand levels, leave days and closures. Ported from the original simulator (range, leaveDays, isClosed, …).
import type { Level, Option, PatternKey, Season } from "../types.ts";

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const LEVELS = ["Low demand", "Normal demand", "High demand", "Peak"];
const DAY = 864e5;

export function utc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
export function addDays(iso: string, n: number): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n));
}
export function fmt(d: Date): string { return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()]; }
export function isoOf(d: Date): string { return d.toISOString().slice(0, 10); }

// The season's patterns are for 4 ski days (5 nights). A 5th ski day adds a night at the end: Thu → Tue
// becomes Thu → Wed, with one more night of house and one more day of food.
export const extraNights = (days: number) => Math.max(0, days - 4);
export const nights = (season: Season, days: number) => season.nights + extraNights(days);
export const foodDays = (season: Season, days: number) => season.foodDays + extraNights(days);
export function patternLabel(season: Season, pattern: PatternKey, days: number): string {
  const p = season.patterns[pattern];
  return WDAYS[addDays(season.weeks[0], p.from).getUTCDay()] + " → " + WDAYS[addDays(season.weeks[0], p.to + extraNights(days)).getUTCDay()];
}

export interface Range { a: Date; b: Date; text: string }
export function range(season: Season, pattern: PatternKey, w: number, days = 4): Range {
  const p = season.patterns[pattern];
  const a = addDays(season.weeks[w], p.from), b = addDays(season.weeks[w], p.to + extraNights(days));
  return { a, b, text: WDAYS[a.getUTCDay()] + " " + fmt(a) + " → " + WDAYS[b.getUTCDay()] + " " + fmt(b) };
}

export function isClosed(season: Season, d: Option, pattern: PatternKey, w: number, days = 4): boolean {
  return range(season, pattern, w, days).b.getTime() > utc(d.close);
}
export function closeTxt(d: Option): string {
  const [, m, day] = d.close.split("-").map(Number);
  return day + " " + MONTHS[m - 1] + (d.closeEst ? " (estimated)" : "");
}
export function late(season: Season, w: number): boolean { return w >= season.springFromWeek; }

/** Weekdays inside the stay that aren't public holidays at the origin = days of annual leave needed. */
export function leaveDays(season: Season, pattern: PatternKey, w: number, days = 4): number {
  const r = range(season, pattern, w, days);
  const hol = season.holidays.map((h) => utc(h.date));
  let n = 0;
  for (let t = r.a.getTime(); t <= r.b.getTime(); t += DAY) {
    const wd = new Date(t).getUTCDay();
    if (wd > 0 && wd < 6 && hol.indexOf(t) < 0) n++;
  }
  return n;
}
/** A "soft" holiday (e.g. Carnival Tuesday in Portugal) that many people get off, flagged with * rather than subtracted. */
export function softHoliday(season: Season, pattern: PatternKey, w: number, days = 4) {
  const r = range(season, pattern, w, days);
  return season.softHolidays.find((h) => { const t = utc(h.date); return r.a.getTime() <= t && r.b.getTime() >= t; }) || null;
}

export function level(season: Season, market: string, w: number): Level {
  const row = season.demand[market];
  if (!row) throw new Error(`no demand row for market ${market}`);
  return row[w];
}
export function weekLevel(season: Season, w: number): Level {
  let m = 0;
  for (const k of Object.keys(season.demand)) m = Math.max(m, season.demand[k][w]);
  return m as Level;
}

/** Week index whose Wed→Tue window shares the most nights with [checkin, checkout); -1 if none. */
export function weekOfStay(season: Season, checkin: string, checkout: string): number {
  const a = utc(checkin), b = utc(checkout);
  let best = -1, bestN = 0;
  season.weeks.forEach((sat, i) => {
    const wa = utc(sat) - 3 * DAY, wb = utc(sat) + 4 * DAY;
    const n = Math.max(0, (Math.min(b, wb) - Math.max(a, wa)) / DAY);
    if (n > bestN) { bestN = n; best = i; }
  });
  return best;
}
export function nightsBetween(checkin: string, checkout: string): number { return Math.round((utc(checkout) - utc(checkin)) / DAY); }
