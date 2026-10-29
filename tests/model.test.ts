import { test } from "node:test";
import assert from "node:assert/strict";
import { LISTINGS, OPTIONS, SEASON } from "../src/data.ts";
import { bedrooms, cars, people, transferFactor } from "../src/model/group.ts";
import { houses, median, priceFor, stayFromHouses } from "../src/model/houses.ts";
import { calc } from "../src/model/cost.ts";
import { weekOfStay } from "../src/model/calendar.ts";
import { decodeShare, defaults, encodeShare, sanitize } from "../src/state.ts";
import type { Group, Listing, Settings } from "../src/types.ts";

const G = (couples: number, solo: number, soloRooms: "shared" | "own" = "shared"): Group => ({ couples, solo, soloRooms });

test("people and bedrooms", () => {
  assert.equal(people(G(2, 0)), 4); assert.equal(bedrooms(G(2, 0)), 2);
  assert.equal(people(G(4, 1)), 9); assert.equal(bedrooms(G(4, 1)), 5);
  assert.equal(bedrooms(G(0, 3, "shared")), 2); assert.equal(bedrooms(G(0, 3, "own")), 3);
  assert.equal(bedrooms(G(1, 0)), 1);
  assert.equal(people(G(0, 0)), 1); // never zero
});

test("cars and transfer vehicles", () => {
  assert.deepEqual([1, 4, 5, 6, 10, 11].map(cars), [1, 1, 1, 2, 2, 3]);
  assert.equal(transferFactor(4), 1);
  assert.equal(transferFactor(5), 1.4);
  assert.equal(transferFactor(8), 1.4);
  assert.equal(transferFactor(9), 2.4); // a van of 5 + a car of 4
  assert.equal(transferFactor(16), 2.8);
});

const L = (id: string, total: number, extra: Partial<Listing> = {}): Listing => ({
  id, resort: "soldeu", url: "https://x/" + id, title: id, source: "x", bedrooms: 2, sleeps: 4,
  quotes: [{ checkin: "2027-03-07", checkout: "2027-03-12", nights: 5, total }],
  rating: null, toLiftM: null, photo: null, addedBy: "", ...extra,
});
const W = 6; // week of 6 Mar 2027, the week those quotes fall in

test("a quote is assigned to the week it overlaps most", () => {
  assert.equal(weekOfStay(SEASON, "2027-03-07", "2027-03-12"), 6);
  assert.equal(weekOfStay(SEASON, "2027-03-03", "2027-03-08"), 6);
  assert.equal(weekOfStay(SEASON, "2026-12-01", "2026-12-06"), -1);
});

test("tier split for 0, 1, 2, 3 and 7 houses", () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => L("h" + i, 1000 + 100 * i));
  assert.equal(houses(SEASON, "aduk", mk(0), G(2, 0), W).mode, "none");
  assert.equal(houses(SEASON, "aduk", mk(1), G(2, 0), W).mode, "few");
  assert.equal(stayFromHouses(houses(SEASON, "aduk", mk(2), G(2, 0), W), "mid"), 1050);
  const t3 = houses(SEASON, "aduk", mk(3), G(2, 0), W);
  assert.deepEqual(t3.tiers.map((t) => t.listings.length), [1, 1, 1]);
  const t7 = houses(SEASON, "aduk", mk(7), G(2, 0), W);
  assert.deepEqual(t7.tiers.map((t) => t.listings.length), [3, 2, 2]);
  assert.deepEqual(t7.tiers.map((t) => t.median), [1100, 1350, 1550]);
});

test("best pick: highest rating, then nearest the lifts", () => {
  const xs = [L("a", 1000, { rating: 8 }), L("b", 1010, { rating: 9, toLiftM: 500 }), L("c", 1020, { rating: 9, toLiftM: 100 })];
  assert.equal(houses(SEASON, "aduk", xs, G(2, 0), W).tiers[0].pick.l.id, "a"); // alone in its tier
  const t = houses(SEASON, "aduk", [...xs, L("d", 900), L("e", 950), L("f", 990)], G(2, 0), W);
  assert.equal(t.tiers[2].pick.l.id, "c");
});

test("houses must fit: enough beds, enough bedrooms, not more than 2 extra", () => {
  const big = L("big", 4000, { bedrooms: 5, sleeps: 10 }), small = L("small", 800, { bedrooms: 1, sleeps: 2 });
  assert.equal(houses(SEASON, "aduk", [big, small], G(2, 0), W).mode, "none");
  assert.equal(houses(SEASON, "aduk", [big], G(4, 1), W).eligible.length, 1);
});

test("price round-trip: a peak-week quote moved to a normal week and back", () => {
  const peak = { checkin: "2027-02-14", checkout: "2027-02-19", nights: 5, total: 1600 }; // week 3, peak for aduk (×1.6)
  const l = L("p", 0, { quotes: [peak] });
  const normalWeek = SEASON.demand.aduk.indexOf(1);
  assert.equal(priceFor(SEASON, "aduk", l, normalWeek).total, 1000);
  assert.deepEqual(priceFor(SEASON, "aduk", l, 3), { total: 1600, exact: true, quote: peak });
});

test("several quotes: median of their normal-week prices", () => {
  const l = L("m", 0, { quotes: [
    { checkin: "2027-01-24", checkout: "2027-01-29", nights: 5, total: 900 },   // low ×0.9 → 1000
    { checkin: "2027-03-07", checkout: "2027-03-12", nights: 5, total: 1100 },  // normal → 1100
    { checkin: "2027-02-14", checkout: "2027-02-19", nights: 5, total: 2400 },  // peak ×1.6 → 1500
  ] });
  assert.equal(priceFor(SEASON, "aduk", l, 7).total, Math.round(1100 * 0.9)); // week 7 is low for aduk
});

test("seed: 4 couples + 1 solo in Soldeu, 3–8 Mar, matches the shortlist", () => {
  const sol = LISTINGS.filter((l) => l.resort === "soldeu");
  const h = houses(SEASON, "aduk", sol, G(4, 1), W);
  assert.equal(h.mode, "tiers");
  assert.deepEqual(h.tiers.map((t) => t.median), [3443, 3932, 4323]);
  const s: Settings = { ...defaults(), group: G(4, 1), house: "mid" };
  const opt = OPTIONS.find((o) => o.id === "sol-tls")!;
  const c = calc(SEASON, s, opt, W, sol);
  assert.equal(c.stay.source, "houses");
  assert.equal(c.stayTotal, 3932);
  assert.equal(c.people, 9);
});

test("median", () => {
  assert.equal(median([3, 1, 2]), 2); assert.equal(median([4, 1, 2, 3]), 2.5); assert.ok(Number.isNaN(median([])));
});

test("share link round-trip and sanitising", () => {
  const s = { ...defaults(), week: 6, group: G(4, 1, "own"), house: "lux" as const, edits: { "sol-tls@6": { flight: 99 } } };
  const back = decodeShare("#" + encodeShare(s), SEASON.weeks.length)!;
  assert.equal(back.week, 6); assert.deepEqual(back.group, s.group); assert.equal(back.house, "lux");
  assert.deepEqual(back.edits, s.edits);
  const bad = sanitize({ week: 99, days: 7, group: { couples: -3, solo: "x" }, beg: 50, edits: { "<script>": { a: 1 } } }, 12);
  assert.equal(bad.week, 11); assert.equal(bad.days, 5); assert.deepEqual(bad.group, G(0, 1)); assert.equal(bad.beg, 1);
  assert.deepEqual(bad.edits, {});
  assert.equal(decodeShare("#s=%%%garbage", 12), null);
});
