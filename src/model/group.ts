// Group size → people, bedrooms and vehicles. Couples always share one bedroom; solo friends either share
// twin rooms (two per room) or get their own room.
import type { Group } from "../types.ts";

export const SEATS_PER_CAR = 5;
export const SEATS_PER_TRANSFER = 8;
export const VAN_FACTOR = 1.4; // a 5–8 seat van costs ~40% more than a 1–4 seat car transfer

export function people(g: Group): number { return Math.max(1, 2 * g.couples + g.solo); }

export function bedrooms(g: Group): number {
  const solo = g.soloRooms === "own" ? g.solo : Math.ceil(g.solo / 2);
  return Math.max(1, g.couples + solo);
}

export function cars(p: number): number { return Math.ceil(p / SEATS_PER_CAR); }

/** Multiplier on the per-vehicle transfer price: vehicles of up to 8, a van (×1.4) when a vehicle carries more than 4. */
export function transferFactor(p: number): number {
  const n = Math.ceil(p / SEATS_PER_TRANSFER);
  const base = Math.floor(p / n), extra = p % n;
  let f = 0;
  for (let i = 0; i < n; i++) {
    const load = base + (i < extra ? 1 : 0);
    f += load > 4 ? VAN_FACTOR : 1;
  }
  return f;
}

export function describe(g: Group): string {
  const p = people(g), b = bedrooms(g);
  const bits: string[] = [];
  if (g.couples) bits.push(g.couples + (g.couples === 1 ? " couple" : " couples"));
  if (g.solo) bits.push(g.solo + (g.solo === 1 ? " solo friend" : " solo friends"));
  return `${bits.join(" + ") || "1 person"} · ${p} ${p === 1 ? "person" : "people"} · ${b} ${b === 1 ? "bedroom" : "bedrooms"}`;
}
