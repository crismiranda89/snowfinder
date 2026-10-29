// Builds tests/fixtures/golden.json from the ORIGINAL single-file artifact (golden/original.html).
// It evaluates the original pricing code (BASE … calc) untouched, so the port can be checked for exact parity.
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../tests/fixtures/original-simulator.html", import.meta.url), "utf8");
const start = html.indexOf("var BASE = [");
const end = html.indexOf("function rkey(");
if (start < 0 || end < 0) throw new Error("original pricing code not found");
const code = html.slice(start, end).replace(/try \{ var saved[\s\S]*?catch\(e\)\{\}\s*\}/, "");

const ctx = { localStorage: { getItem: () => null, setItem() {} } };
vm.createContext(ctx);
vm.runInContext(code + "\n;this.__api = {BASE, WEEKS, PATTERNS, calc, isClosed, leaveDays, get state(){return state}, set state(v){state=v}};", ctx);
const api = ctx.__api;

const scenarios = [
  { food: 40, beg: 3 },
  { food: 55, beg: 0 },
  { food: 25, beg: 4 },
];
const out = [];
for (const sc of scenarios) for (const pattern of Object.keys(api.PATTERNS)) for (const days of [4, 5]) for (const ground of ["car", "transfer"]) {
  api.state = { pattern, week: 0, days, ground, limit: false, food: sc.food, beg: sc.beg, dest: [], edits: {} };
  for (const d of api.BASE) api.WEEKS.forEach((_, w) => {
    const c = api.calc(d, w);
    out.push({ id: d.id, w, pattern, days, ground, food: sc.food, beg: sc.beg, pp: +c.pp.toFixed(6), closed: api.isClosed(d, w), leave: api.leaveDays(w) });
  });
}
writeFileSync(new URL("../tests/fixtures/golden.json", import.meta.url), JSON.stringify(out));
console.log("golden rows:", out.length);
