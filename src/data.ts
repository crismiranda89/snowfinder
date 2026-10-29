// Loads the JSON data files and flattens resort × airport into the Option rows the model works on.
import resortsJson from "../data/resorts.json" with { type: "json" };
import seasonJson from "../data/season-2027.json" with { type: "json" };
import listingsJson from "../data/generated/listings.json" with { type: "json" };
import type { Listing, Option, Resort, ResortsFile, Season } from "./types.ts";

export const RESORTS_FILE = resortsJson as unknown as ResortsFile;
export const SEASON = seasonJson as unknown as Season;
export const LISTINGS = (listingsJson as unknown as { listings: Listing[] }).listings;
// "…, 4 beds, …" in a listing's notes (Booking.com counts a double as one bed).
for (const l of LISTINGS) { const m = /(\d+) (?:real |separate |single )?beds?\b/.exec(l.notes || ""); if (m) l.beds = +m[1]; }

export function buildOptions(resorts: Resort[], season: Season): Option[] {
  const out: Option[] = [];
  for (const r of resorts) {
    const rs = season.resorts[r.id];
    if (!rs) throw new Error(`season has no prices for resort ${r.id}`);
    for (const a of r.airports) {
      const o = season.options[a.id];
      if (!o) throw new Error(`season has no prices for option ${a.id}`);
      out.push({
        id: a.id, resort: r.id, name: r.name, country: r.country, region: r.region || r.country, air: a.airport, code: a.code, time: a.time,
        km: a.km, mins: a.mins, alt: r.altitude, apres: r.compare.apres[0], mkt: r.market,
        flight: o.flight, car: o.car, transfer: o.transfer, stay: rs.stay,
        pass4: rs.pass4, pass5: rs.pass5, rent4: rs.rent4, rent5: rs.rent5, lesson: rs.lesson,
        close: rs.close, closeEst: rs.closeEst, passEst: rs.passEst, dynPass: rs.dynPass,
        meal: r.compare.meal?.[0] ?? 25, spring: r.spring, flag: o.flag,
      });
    }
  }
  return out;
}

export const OPTIONS = buildOptions(RESORTS_FILE.resorts, SEASON);
export const RESORT_BY_ID: Record<string, Resort> = Object.fromEntries(RESORTS_FILE.resorts.map((r) => [r.id, r]));
