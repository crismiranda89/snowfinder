import { test } from "node:test";
import assert from "node:assert/strict";
import { LISTINGS, OPTIONS, RESORTS_FILE, SEASON } from "../src/data.ts";
import { bedrooms, cars, people, transferFactor } from "../src/model/group.ts";
import { fits, houses, median, nearLifts, priceFor, stayFromHouses, walkMins } from "../src/model/houses.ts";
import { calc, foodPerDay } from "../src/model/cost.ts";
import { foodDays, isClosed, leaveDays, nights, patternLabel, range, weekOfStay } from "../src/model/calendar.ts";
import { decodeShare, defaults, encodeShare, sanitize } from "../src/state.ts";
import type { Group, Listing, Settings } from "../src/types.ts";

const G = (couples: number, solo: number, soloRooms: Group["soloRooms"] = "shared"): Group => ({ couples, solo, soloRooms });

test("people and bedrooms", () => {
  assert.equal(people(G(2, 0)), 4); assert.equal(bedrooms(G(2, 0)), 2);
  assert.equal(people(G(4, 1)), 9); assert.equal(bedrooms(G(4, 1)), 5);
  assert.equal(bedrooms(G(0, 3, "shared")), 2); assert.equal(bedrooms(G(0, 3, "own")), 3);
  assert.equal(bedrooms(G(4, 1, "common")), 4); assert.equal(people(G(4, 1, "common")), 9); assert.equal(bedrooms(G(0, 2, "common")), 1);
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
  const s: Settings = { ...defaults(), group: G(4, 1), house: "mid", nearLifts: false }; // all 4 shortlisted houses
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
  const s = { ...defaults(), week: 6, group: G(3, 0, "common"), house: "lux" as const, edits: { "sol-tls@6": { flight: 99 } } };
  const back = decodeShare("#" + encodeShare(s), SEASON.weeks.length)!;
  assert.equal(back.week, 6); assert.deepEqual(back.group, s.group); assert.equal(back.house, "lux");
  assert.deepEqual(back.edits, s.edits);
  const bad = sanitize({ week: 99, days: 7, group: { couples: -3, solo: "x" }, beg: 50, edits: { "<script>": { a: 1 } } }, 12);
  assert.equal(bad.week, 11); assert.equal(bad.days, 5); assert.deepEqual(bad.group, G(4, 1, "common")); assert.equal(bad.beg, 0); // unknown groups fall back to 4 couples + 1; lessons are off
  assert.deepEqual(sanitize({ group: G(0, 4, "own") }, 12).group, G(0, 4, "own")); // 4 friends, own rooms
  assert.deepEqual(sanitize({ group: G(0, 4, "shared") }, 12).group, G(0, 4, "shared")); // 4 friends, 2 rooms
  assert.deepEqual(sanitize({ group: G(0, 4, "twin") }, 12).group, G(0, 4, "twin")); // 4 friends, a bed each
  assert.deepEqual(sanitize({ group: G(2, 3) }, 12).group, G(4, 1, "common")); // only the listed group setups exist
  assert.deepEqual(bad.edits, {});
  assert.equal(bad.nearLifts, true); assert.equal(sanitize({ nearLifts: false }, 12).nearLifts, false);
  assert.equal(decodeShare("#s=%%%garbage", 12), null);
});

test("every option belongs to an area; Andorra groups Soldeu and Pas de la Casa", () => {
  for (const o of OPTIONS) assert.ok(o.region, `${o.id} has no region`);
  const andorra = new Set(OPTIONS.filter((o) => o.region === "Andorra").map((o) => o.resort));
  assert.deepEqual([...andorra].sort(), ["pas-de-la-casa", "soldeu"]);
});

test("every airport has a flight time from the origin", () => {
  for (const o of OPTIONS) assert.ok(SEASON.flightTimes[o.code]?.mins > 0, `${o.code} has no flight time`);
});

test("food plans scale with the resort's meal-out price; custom uses the daily amount", () => {
  const pas = OPTIONS.find((o) => o.id === "pas-tls")!, vt = OPTIONS.find((o) => o.id === "vt-gva")!;
  const s = (foodPlan: Settings["foodPlan"]) => ({ ...defaults(), foodPlan, food: 40 });
  assert.equal(foodPerDay(s("home"), pas), 12); assert.equal(foodPerDay(s("one"), pas), 28); assert.equal(foodPerDay(s("both"), pas), 44);
  assert.ok(foodPerDay(s("both"), vt) > foodPerDay(s("both"), pas));
  assert.equal(foodPerDay(s("custom"), vt), 40);
  assert.equal(calc(SEASON, s("one"), pas, 0).parts.food, 28 * SEASON.foodDays);
});

test("near the lifts: within a 10-minute walk, unknown distance excluded", () => {
  assert.equal(walkMins(900), 12); assert.equal(walkMins(750), 10); assert.equal(walkMins(20), 1);
  const at = (toLiftM: number | null) => ({ ...LISTINGS[0], toLiftM });
  assert.ok(nearLifts(at(750))); assert.ok(!nearLifts(at(900))); assert.ok(!nearLifts(at(null)));
  const sol = LISTINGS.filter((l) => l.resort === "soldeu");
  const all = houses(SEASON, "aduk", sol, G(4, 1), 6), near = houses(SEASON, "aduk", sol, G(4, 1), 6, true);
  assert.ok(near.eligible.every((x) => nearLifts(x.l)));
  assert.ok(near.eligible.length < all.eligible.length);
});

test("5 ski days add a night: dates, label, food days, house price", () => {
  const r4 = range(SEASON, "thu", 6, 4), r5 = range(SEASON, "thu", 6, 5);
  assert.equal(r4.text, "Thu 4 Mar → Tue 9 Mar"); assert.equal(r5.text, "Thu 4 Mar → Wed 10 Mar");
  assert.equal(patternLabel(SEASON, "thu", 5), "Thu → Wed"); assert.equal(patternLabel(SEASON, "fri", 5), "Fri → Thu");
  assert.equal(nights(SEASON, 5), 6); assert.equal(foodDays(SEASON, 5), 7);
  assert.equal(leaveDays(SEASON, "thu", 6, 5), leaveDays(SEASON, "thu", 6, 4) + 1);
  const opt = OPTIONS.find((o) => o.id === "sol-tls")!;
  const s4 = { ...defaults(), days: 4 as const }, s5 = { ...defaults(), days: 5 as const };
  const c4 = calc(SEASON, s4, opt, 6, []), c5 = calc(SEASON, s5, opt, 6, []);
  assert.ok(Math.abs(c5.stayTotal - c4.stayTotal * 6 / 5) <= 1);
  assert.equal(c5.parts.food, c4.parts.food / 6 * 7);
  // a stay that ends one day later can run past a resort's closing date
  const pas = OPTIONS.find((o) => o.id === "pas-tls")!;
  assert.ok(SEASON.weeks.some((_, w) => !isClosed(SEASON, pas, "thu", w, 4) || isClosed(SEASON, pas, "thu", w, 5)));
});

test("a picked house survives saving and share links; junk is dropped", () => {
  assert.equal(sanitize({ pick: "e4ca9ff38c" }, 12).pick, "e4ca9ff38c");
  assert.equal(sanitize({ pick: "<script>" }, 12).pick, undefined);
  const back = decodeShare("#" + encodeShare({ ...defaults(), pick: "68b19f100b" }), 12)!;
  assert.equal(back.pick, "68b19f100b");
});

test("every resort has a description and things to do when not skiing", () => {
  for (const r of RESORTS_FILE.resorts) {
    const f = RESORTS_FILE.fit.find((x) => x.resort === r.id);
    assert.ok(f?.text && f.offski, `${r.id} is missing its description or non-ski activities`);
  }
});

test("4 separate beds, any rooms: a listing needs 4 beds, or 4 bedrooms; an unknown bed count doesn't fit", () => {
  const g = G(0, 4, "twin");
  const l = (beds: number | undefined, bedrooms = 2) => ({ ...LISTINGS[0], bedrooms, sleeps: 4, beds });
  assert.equal(fits(l(4), g), true);
  assert.equal(fits(l(3), g), false); // 2 singles + 1 double
  assert.equal(fits(l(undefined), g), false);
  assert.equal(fits(l(undefined, 4), g), true);
  assert.equal(fits(l(4, 1), g), true); // all four beds in one room is fine
  assert.equal(bedrooms(g), 1);
  assert.equal(fits(l(3), G(0, 4, "shared")), true);
});
