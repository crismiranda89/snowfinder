// Shared types. Prices follow the original simulator: flight, pass, rental and lesson are per person;
// car is per car, transfer per vehicle (up to 4 passengers), stay is the whole group for the whole stay.

export type Level = 0 | 1 | 2 | 3;
export type PatternKey = "wed" | "thu" | "fri";
export type Ground = "car" | "transfer";
export type Tier = "budget" | "mid" | "lux";
export type Field = "flight" | "car" | "transfer" | "stay" | "pass4" | "pass5" | "rent4" | "rent5" | "lesson";

export interface Pattern { from: number; to: number; label: string }

export interface Season {
  season: string;
  collected: string;
  origin: { city: string; code: string; country: string };
  nights: number;
  foodDays: number;
  baseBedrooms: number;
  springFromWeek: number;
  weeks: string[];
  patterns: Record<PatternKey, Pattern>;
  multipliers: { stay: number[]; flight: number[]; ground: number[]; dynPass: number[] };
  demand: Record<string, Level[]>;
  weekNotes: string[];
  holidays: { date: string; name: string }[];
  softHolidays: { date: string; name: string; note: string }[];
  resorts: Record<string, ResortSeason>;
  options: Record<string, { flight: number; car: number; transfer: number; flag?: string }>;
  sources: Record<string, { label: string; url: string; note?: string }[]>;
}

export interface ResortSeason {
  stay: number; pass4: number; pass5: number; rent4: number; rent5: number; lesson: number;
  close: string; closeEst?: boolean; passEst?: boolean; dynPass?: boolean; events: string;
}

export type Stars = [number, string];
export interface Resort {
  id: string; name: string; compareName?: string; searchName?: string; country: string; area: string; altitude: string;
  /** Wider area the grid and ranking group by (e.g. "Andorra"); falls back to the country. */
  region?: string;
  market: string; spring: "good" | "ok" | "poor";
  airports: { id: string; airport: string; code: string; time: string; km: number; mins: number }[];
  compare: {
    snow: Stars; temp: [string, string]; area: [string, string]; beginners: Stars; snowboard: Stars;
    expert: Stars; apres: Stars; beer: string; wind: ["low" | "mid" | "high", string]; insurance: string;
  };
}

export interface ResortsFile {
  resorts: Resort[];
  fit: { resort: string; tag: string; tone: string; text: string }[];
  fitFootnote: string;
}

/** One resort reached from one airport — the row unit of the grid, ranking and detail table. */
export interface Option {
  id: string; resort: string; name: string; country: string; region: string; air: string; code: string; time: string;
  km: number; mins: number; alt: string; apres: number; mkt: string;
  flight: number; car: number; transfer: number; stay: number;
  pass4: number; pass5: number; rent4: number; rent5: number; lesson: number;
  close: string; closeEst?: boolean; passEst?: boolean; dynPass?: boolean;
  spring: "good" | "ok" | "poor"; flag?: string;
}

export interface Group { couples: number; solo: number; soloRooms: "shared" | "own" }

/** One price quote for a listing: the total for the whole stay, as seen on the listing for those dates. */
export interface Quote { checkin: string; checkout: string; nights: number; total: number }

export interface Listing {
  id: string; resort: string; url: string; title: string; source: string;
  bedrooms: number; sleeps: number; quotes: Quote[];
  rating: number | null; toLiftM: number | null; photo: string | null; addedBy: string; notes?: string;
}

export type Edits = Record<string, Partial<Record<Field, number>>>;

export interface Settings {
  pattern: PatternKey;
  days: 4 | 5;
  ground: Ground;
  food: number;
  beg: number;
  group: Group;
  house: Tier;
  edits: Edits;
}
