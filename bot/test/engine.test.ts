import { test } from "node:test";
import assert from "node:assert/strict";
import { MAJORITY, evaluate, parseHours, parsePct, required, ruleFor, DEFAULT_RULES, withRule } from "../src/engine.ts";

test("required yes votes", () => {
  assert.equal(required(80, 5), 4);       // "a house needs 4 of 5"
  assert.equal(required(80, 9), 8);
  assert.equal(required(60, 9), 6);
  assert.equal(required(100, 9), 9);
  for (const [n, need] of [[1, 1], [2, 2], [3, 2], [4, 3], [5, 3], [9, 5], [10, 6]]) assert.equal(required(MAJORITY, n), need, `majority of ${n}`);
  assert.equal(required(80, 0), 1);
});

test("evaluate: passes early, fails early when blocked, decides at the deadline", () => {
  assert.equal(evaluate({ yes: 4, no: 0 }, 4, 5, 0, 10).status, "passed");
  assert.deepEqual(evaluate({ yes: 1, no: 2 }, 4, 5, 0, 10), { status: "failed", reason: "blocked" }); // 5−2 = 3 < 4
  assert.equal(evaluate({ yes: 3, no: 1 }, 4, 5, 0, 10).status, "open");
  assert.deepEqual(evaluate({ yes: 3, no: 0 }, 4, 5, 10, 10), { status: "failed", reason: "timeout" });
});

test("only round thresholds and sane timeouts", () => {
  assert.equal(parsePct("80"), 80); assert.equal(parsePct("80%"), 80); assert.equal(parsePct("majority"), MAJORITY);
  assert.equal(parsePct("75"), null); assert.equal(parsePct("40"), null); assert.equal(parsePct("110"), null);
  assert.equal(parseHours("48"), 48); assert.equal(parseHours("2d"), 48); assert.equal(parseHours("0"), null); assert.equal(parseHours("999d"), null);
});

test("type aliases and rule changes", () => {
  assert.equal(ruleFor(DEFAULT_RULES, "Hotel")!.type, "house");
  assert.equal(ruleFor(DEFAULT_RULES, "voos")!.type, "flights");
  assert.equal(ruleFor(DEFAULT_RULES, "pizza"), null);
  const next = withRule(DEFAULT_RULES, { type: "house", label: "x", pct: 100, hours: 12 });
  assert.deepEqual(next.find((r) => r.type === "house"), { type: "house", label: "House / hotel", pct: 100, hours: 12 });
  assert.equal(DEFAULT_RULES.find((r) => r.type === "house")!.pct, 80); // unchanged
});
