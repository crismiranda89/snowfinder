// Parity with the original single-file simulator: same prices for every option, week, stay pattern,
// ski-day count, ground transport and two food/beginner settings, for a group of 2 couples and no listings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildOptions } from "../src/data.ts";
import resorts from "./fixtures/original-data/resorts.json" with { type: "json" };
import season2027 from "./fixtures/original-data/season-2027.json" with { type: "json" };
import type { ResortsFile, Season } from "../src/types.ts";
import { calc } from "../src/model/cost.ts";
import { isClosed, leaveDays } from "../src/model/calendar.ts";
import type { Settings } from "../src/types.ts";

// Frozen copies of the data as ported, so fixing a price in data/ doesn't break the model check.
const SEASON = season2027 as unknown as Season;
const OPTIONS = buildOptions((resorts as unknown as ResortsFile).resorts, SEASON);
const golden = JSON.parse(readFileSync(new URL("./fixtures/golden.json", import.meta.url), "utf8"));
const byId = Object.fromEntries(OPTIONS.map((o) => [o.id, o]));

test("every original option exists in the new data", () => {
  const ids = new Set(golden.map((g: any) => g.id));
  assert.equal(OPTIONS.length, ids.size);
  for (const id of ids) assert.ok(byId[id as string], `missing ${id}`);
});

test(`matches ${golden.length} prices from the original simulator`, () => {
  let n = 0;
  for (const g of golden) {
    const s: Settings = { pattern: g.pattern, days: g.days, ground: g.ground, food: g.food, beg: g.beg,
      group: { couples: 2, solo: 0, soloRooms: "shared" }, house: "mid", edits: {} };
    const c = calc(SEASON, s, byId[g.id], g.w, []);
    assert.ok(Math.abs(c.pp - g.pp) < 1e-6, `${g.id} w${g.w} ${g.pattern} ${g.days}d ${g.ground}: ${c.pp} ≠ ${g.pp}`);
    assert.equal(isClosed(SEASON, byId[g.id], g.pattern, g.w), g.closed);
    assert.equal(leaveDays(SEASON, g.pattern, g.w), g.leave);
    n++;
  }
  assert.equal(n, golden.length);
});
