// Vote rules and outcomes. Pure functions only, so the whole decision logic is unit-tested.
//
// Every vote type has a threshold (a round percentage, or "majority") and a timeout. The number of
// yes votes needed is fixed when the vote opens, from the members registered at that moment:
//   required = ceil(pct × members)            e.g. house 80% of 5 people → 4
//   majority = more than half                 e.g. 9 people → 5
// A vote passes as soon as yes ≥ required, fails as soon as it can no longer get there,
// and at its deadline passes or fails on the yes count.

export const MAJORITY = 51; // stored as 51 so ceil(51% × n) is "more than half" for any n ≤ 100

export interface Rule { type: string; label: string; pct: number; hours: number }

export const DEFAULT_RULES: Rule[] = [
  { type: "house", label: "House / hotel", pct: 80, hours: 48 },
  { type: "resort", label: "Resort", pct: 60, hours: 72 },
  { type: "dates", label: "Dates", pct: 80, hours: 48 },
  { type: "flights", label: "Flights", pct: 60, hours: 24 },
  { type: "other", label: "Anything else", pct: MAJORITY, hours: 24 },
];
/** Rules about rules: agreeing the charter or changing one rule always needs a simple majority within 24h. */
export const META_RULE: Rule = { type: "charter", label: "Group rules", pct: MAJORITY, hours: 24 };

export const ALIASES: Record<string, string> = {
  house: "house", hotel: "house", apartment: "house", chalet: "house", casa: "house",
  resort: "resort", estancia: "resort", "estância": "resort",
  dates: "dates", date: "dates", week: "dates", datas: "dates",
  flights: "flights", flight: "flights", voo: "flights", voos: "flights",
  other: "other",
};

export function required(pct: number, electorate: number): number {
  return Math.max(1, Math.ceil((pct * electorate) / 100 - 1e-9));
}

export function pctLabel(pct: number): string { return pct === MAJORITY ? "majority" : pct + "%"; }

/** Parses "80", "80%" or "majority" into a stored percentage; only round numbers (10% steps) are allowed. */
export function parsePct(s: string): number | null {
  const t = s.trim().toLowerCase().replace(/%$/, "");
  if (t === "majority" || t === "maioria") return MAJORITY;
  const n = Number(t);
  return Number.isInteger(n) && n >= 50 && n <= 100 && n % 10 === 0 ? n : null;
}
export function parseHours(s: string): number | null {
  const t = s.trim().toLowerCase();
  const m = /^(\d{1,3})(h|d)?$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]) * (m[2] === "d" ? 24 : 1);
  return h >= 1 && h <= 24 * 14 ? h : null;
}

export type Status = "open" | "passed" | "failed" | "cancelled";
export interface Tally { yes: number; no: number }

export function evaluate(t: Tally, need: number, electorate: number, now: number, deadline: number): { status: Status; reason?: "reached" | "blocked" | "timeout" } {
  if (t.yes >= need) return { status: "passed", reason: "reached" };
  if (electorate - t.no < need) return { status: "failed", reason: "blocked" };
  if (now >= deadline) return { status: "failed", reason: "timeout" };
  return { status: "open" };
}

export function ruleFor(rules: Rule[], typeWord: string | undefined): Rule | null {
  if (!typeWord) return null;
  const key = ALIASES[typeWord.toLowerCase()] ?? typeWord.toLowerCase();
  return rules.find((r) => r.type === key) ?? null;
}

export function withRule(rules: Rule[], change: Rule): Rule[] {
  const i = rules.findIndex((r) => r.type === change.type);
  return i < 0 ? [...rules, change] : rules.map((r, j) => (j === i ? { ...r, pct: change.pct, hours: change.hours } : r));
}

export function rulesTable(rules: Rule[]): string {
  return rules.map((r) => `• ${r.label} (<code>${r.type}</code>): ${pctLabel(r.pct)} within ${r.hours}h`).join("\n");
}
