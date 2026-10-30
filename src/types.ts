// Shared types. Prices follow the original simulator: flight, pass, rental and lesson are per person;
// car is per car, transfer per vehicle (up to 4 passengers), stay is the whole group for the whole stay.

export type Level = 0 | 1 | 2 | 3;
export type PatternKey = "wed" | "thu" | "fri";
/** How the group gets from the airport: rental car, transfer, or "all" (whichever is cheaper for each route). */
export type Ground = "car" | "transfer" | "all";
export type Tier = "budget" | "mid" | "lux";
/** House level filter: one third of the fitting houses, or all of them. */
export type HouseLevel = Tier | "all";
/** Walk to the lifts filter: any distance, ski in / ski out (≤ 100 m), up to 5 or 10 minutes. */
export type LiftBand = "all" | "ski" | "5" | "10";
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
  /** Typical flight time from the origin, by airport code. stops 1 = no direct flight. */
  flightTimes: Record<string, { mins: number; stops: number; airlines: string }>;
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
    /** Typical € per person for a main course and a drink in a mid-range restaurant, with a note. */
    meal: [number, string]; apres: Stars; beer: string; wind: ["low" | "mid" | "high", string]; insurance: string;
  };
}

export interface ResortsFile {
  resorts: Resort[];
  /** One card per resort: what it's best for, and what friends who don't ski can do. */
  fit: { resort: string; tag: string; tone: string; text: string; offski?: string }[];
  fitFootnote: string;
}

/** One resort reached from one airport — the row unit of the grid, ranking and detail table. */
export interface Option {
  id: string; resort: string; name: string; country: string; region: string; air: string; code: string; time: string;
  km: number; mins: number; alt: string; apres: number; mkt: string;
  flight: number; car: number; transfer: number; stay: number;
  pass4: number; pass5: number; rent4: number; rent5: number; lesson: number;
  close: string; closeEst?: boolean; passEst?: boolean; dynPass?: boolean;
  meal: number; // € per person for a meal out at this resort
  spring: "good" | "ok" | "poor"; flag?: string;
}

export interface Group { couples: number; solo: number; soloRooms: SoloRooms }
/** Where solo friends sleep: two per room, a bed each in any room (twin), a room each, or the living room (sofa bed, no bedroom). */
export type FoodPlan = "home" | "one" | "both" | "custom";
export type SoloRooms = "shared" | "twin" | "own" | "common";

/** One price quote for a listing: the total for the whole stay, as seen on the listing for those dates. */
export interface Quote { checkin: string; checkout: string; nights: number; total: number }

export interface Listing {
  id: string; resort: string; url: string; title: string; source: string;
  bedrooms: number; sleeps: number; quotes: Quote[];
  /** Number of beds when the listing says (a double counts as one); read from its notes. */
  beds?: number;
  rating: number | null; toLiftM: number | null; photo: string | null; addedBy: string; notes?: string;
  /** Where the house is; locApprox when the platform blurs the pin (Airbnb). */
  lat?: number; lng?: number; locApprox?: boolean;
  /** Nearest ski-lift station (OpenStreetMap), straight-line metres. */
  lift?: { name: string; m: number; lat: number; lng: number };
}

export type Edits = Record<string, Partial<Record<Field, number>>>;

export interface Settings {
  pattern: PatternKey;
  days: 4 | 5;
  ground: Ground;
  /** How the group eats; "custom" (or missing) uses `food` € per person per day. */
  foodPlan?: FoodPlan;
  /** Only count houses this close to the lifts; missing = any distance. */
  liftBand?: LiftBand;
  food: number;
  beg: number;
  group: Group;
  house: HouseLevel;
  edits: Edits;
}
