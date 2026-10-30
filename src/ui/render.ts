// Rendering. Ported from the original simulator's render* functions; text is now English and every
// "group of 4" is the group's real size. All data strings go through esc() — listings come from people.
import { LISTINGS, OPTIONS, RESORTS_FILE, RESORT_BY_ID, SEASON } from "../data.ts";
import { LEVELS, MONTHS, closeTxt, extraNights, fmt, foodDays, isClosed, isoOf, late, leaveDays, level, nights, patternLabel, range as seasonRange, softHoliday, weekLevel } from "../model/calendar.ts";
import { FOOD_PLANS, calc, edited, foodPerDay, val, type Calc } from "../model/cost.ts";
import { bedrooms, cars, describe, people, transferFactor } from "../model/group.ts";
import { LEVEL_LABEL, LIFT_BANDS, TIER_LABEL, houses, nearLifts, priceFor, walkMins, type HouseResult, type Priced } from "../model/houses.ts";
import type { Field, Listing, Option, PatternKey, Resort, Tier } from "../types.ts";
import { groupId, type State } from "../state.ts";
import { applySort, sortBtn } from "./sort.ts";
import { renderDeck } from "./deck.ts";

const $ = (id: string) => document.getElementById(id)!;
export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
const EUR = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
export const euro = (n: number) => EUR.format(Math.round(n));
const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);
export const hm = (mins: number) => `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}`;

/** Each way of reaching a resort, fastest first: typical flight from the origin plus the drive or shuttle. */
export function routes(r: Resort) {
  return r.airports.map((a) => {
    const f = SEASON.flightTimes[a.code];
    return { a, f, total: f ? f.mins + a.mins : Infinity };
  }).sort((x, y) => x.total - y.total);
}

export const LISTINGS_BY_RESORT: Record<string, Listing[]> = {};
for (const l of LISTINGS) (LISTINGS_BY_RESORT[l.resort] ||= []).push(l);

// ---- per-render cache of calc(option, week)
let cache = new Map<string, Calc>();
export function resetCache() { cache = new Map(); }
function c(s: State, d: Option, w: number): Calc {
  const k = d.id + "@" + w;
  let r = cache.get(k);
  if (!r) { r = withPick(s, d, w, calc(SEASON, s, d, w, LISTINGS_BY_RESORT[d.resort] || [])); cache.set(k, r); }
  return r;
}

export function picked(s: State, resortId: string) { return !s.dest.length || s.dest.includes(resortId); }
/** At the resort of the house you picked, the trip is priced with that house, not the tier's typical one
 *  (a price you typed in the table still wins). */
function withPick(s: State, d: Option, w: number, k: Calc): Calc {
  const l = s.pick ? LISTINGS.find((x) => x.id === s.pick) : undefined;
  if (!l || l.resort !== d.resort || k.stay.source === "edited") return k;
  const total = priceFor(SEASON, d.mkt, l, w, nights(SEASON, s.days)).total;
  const stay = total / k.people, pp = k.pp - k.parts.stay + stay;
  return { ...k, parts: { ...k.parts, stay }, pp, group: pp * k.people, stayTotal: total };
}
export function visible(s: State) { return OPTIONS.filter((d) => picked(s, d.resort)); }
/** The stay's dates for the chosen pattern and number of ski days. */
const dates = (s: State, w: number) => seasonRange(SEASON, s.pattern, w, s.days);
function shut(s: State, d: Option, w: number) { return isClosed(SEASON, d, s.pattern, w, s.days); }

// ---- header bits that only depend on the season
export function renderStatic() {
  const o = SEASON.origin;
  $("origin").textContent = `${o.city} (${o.code})`;
  $("cmporigin").textContent = o.city;
  $("collected").textContent = `Season ${SEASON.season}. Estimates collected on ${fmt(new Date(SEASON.collected))} ${SEASON.collected.slice(0, 4)}. Check flights and houses with real dates before booking.`;
  $("fit").innerHTML = RESORTS_FILE.fit.map((f) =>
    `<div class="fitcard"><span class="tag" style="color:var(--${esc(f.tone)})">${esc(f.tag)}</span><b>${esc(RESORT_BY_ID[f.resort]?.name ?? f.resort)}</b><p>${esc(f.text)}</p>${f.offski ? `<p class="offski"><b>Not skiing:</b> ${esc(f.offski)}</p>` : ""}</div>`).join("");
  $("fitfoot").textContent = RESORTS_FILE.fitFootnote;
  const src = SEASON.sources;
  const links = (xs: { label: string; url: string; note?: string }[]) =>
    xs.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)}</a>${x.note ? ": " + esc(x.note) : ""}`).join(" · ");
  $("cmpsources").innerHTML = `Fastest from ${esc(o.city)}: typical scheduled flight time plus the drive or shuttle, not counting check-in or baggage. Check the real schedule for your dates. ` +
    "Sources: " + links(src.compare || []);
  $("sources").innerHTML = [
    ["School-holiday calendars", src.calendars], ["Closing dates", src.closures], ["Events", src.events],
    ["Lift passes and rental", src.passes], ["Flights, transfers and parking", src.transport],
  ].map(([t, xs]) => `<li><b>${t}:</b> ${links((xs as any) || [])}</li>`).join("");
  renderCompareBody();
}

function renderCompareBody() {
  const st = (v: [number, string]) => `<span class="stars" aria-label="${v[0]} of 5">${"★".repeat(v[0])}<span class="off">${"★".repeat(5 - v[0])}</span></span><small>${esc(v[1])}</small>`;
  const WIND = { low: ["Low", "r-low"], mid: ["Medium", "r-mid"], high: ["High", "r-high"] } as const;
  $("cmpbody").innerHTML = RESORTS_FILE.resorts.map((r) => {
    const cm = r.compare, rs = SEASON.resorts[r.id];
    const air = r.airports.map((a) => `${a.code} ${a.km} km`).join(", ");
    const [best, ...rest] = routes(r);
    const fast = best.f
      ? `<td class="num" data-v="${best.total}"><b>${hm(best.total)}</b><small>${hm(best.f.mins)} flight to ${esc(best.a.code)}${best.f.stops ? " (1 stop)" : ""} + ${hm(best.a.mins)} by road</small>` +
        (rest.length ? `<small>${rest.map((x) => `${esc(x.a.code)} ${x.f ? hm(x.total) : "?"}`).join(" · ")}</small>` : "") + "</td>"
      : `<td data-v="">–</td>`;
    const [wl, wc] = WIND[cm.wind[0]];
    return `<tr data-resort="${esc(r.id)}"><td class="dest" data-v="${esc(r.name)}"><b>${esc(r.compareName || r.name)}</b><small>${esc(r.country)} · ${esc(r.area)} · ${esc(air)}</small></td>` + fast +
      `<td>${st(cm.snow)}</td><td class="num">${esc(cm.temp[0])}<small>${esc(cm.temp[1])}</small></td>` +
      `<td class="num">${esc(cm.area[0])}<small>${esc(cm.area[1])}</small></td>` +
      `<td>${st(cm.beginners)}</td><td>${st(cm.snowboard)}</td><td class="num" data-v="${cm.meal[0]}">~${euro(cm.meal[0])}<small>${esc(cm.meal[1])}</small></td><td>${st(cm.apres)}</td>` +
      `<td class="num">${esc(cm.beer)}</td><td><span class="risk ${wc}">${wl}</span><small>${esc(cm.wind[1])}</small></td>` +
      `<td><small style="margin:0">${esc(cm.insurance)}</small></td><td><small style="margin:0">${esc(rs?.events || "")}</small></td></tr>`;
  }).join("");
}

export function renderControls(s: State) {
  const segs: [string, string][] = [["days", String(s.days)]];
  for (const [id, v] of segs) $(id).querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
  const setNum = (id: string, v: number) => { const el = $(id) as HTMLInputElement; if (document.activeElement !== el) el.value = String(v); };
  const first = dates(s, 0).a, last = dates(s, SEASON.weeks.length - 1).b, n = nights(SEASON, s.days), fd = foodDays(SEASON, s.days);
  $("eyebrow").textContent = `From ${SEASON.origin.city} · ${n} nights · ${fmt(first)} – ${fmt(last)} ${last.getUTCFullYear()}`;
  renderDeck($("pattern"), (Object.keys(SEASON.patterns) as State["pattern"][]).map((v) => ({ v, label: patternLabel(SEASON, v, s.days) })), s.pattern, "🗓");
  renderDeck($("ground"), [{ v: "all", label: "All (cheapest)" }, { v: "car", label: "Rental car" }, { v: "transfer", label: "Transfer" }], s.ground);
  renderDeck($("house"), (["all", "budget", "mid", "lux"] as const).map((v) => ({ v, label: LEVEL_LABEL[v] === "Any" ? "All" : LEVEL_LABEL[v] })), s.house);
  renderDeck($("lift"), (["all", "ski", "5", "10"] as const).map((v) => ({ v, label: LIFT_BANDS[v].label })), s.liftBand || "all");
  $("fooddays").textContent = String(fd);
  const plan = s.foodPlan || "custom";
  renderDeck($("foodPlan"), [...(Object.keys(FOOD_PLANS) as (keyof typeof FOOD_PLANS)[]).map((v) => ({ v, label: FOOD_PLANS[v].label })), { v: "custom", label: "Custom €/person/day" }], plan);
  ($("food") as HTMLInputElement).hidden = plan !== "custom";
  const perDay = OPTIONS.map((d) => foodPerDay(s, d));
  $("foodhint").textContent = plan === "custom" ? `× ${fd} days, arrival to departure`
    : `${euro(Math.min(...perDay))}–${euro(Math.max(...perDay))} per person per day, by resort, × ${fd} days`;
  setNum("food", s.food);
  ($("groupPreset") as HTMLSelectElement).value = groupId(s.group);
  const p = people(s.group);
  const food = s.foodPlan && s.foodPlan !== "custom" ? FOOD_PLANS[s.foodPlan].label : `food ${euro(s.food)}/day`;
  $("filtersum").textContent = [describe(s.group).replace(" · ", " (").replace(" · ", ", ") + ")", s.house === "all" ? "any house level" : `${LEVEL_LABEL[s.house]} house`, food.toLowerCase(),
    s.ground === "car" ? "rental car" : s.ground === "transfer" ? "transfer" : "", LIFT_BANDS[s.liftBand || "all"].text,
    s.dest.length ? `${s.dest.length} of ${RESORTS_FILE.resorts.length} resorts` : ""].filter(Boolean).join(" · ");
  const nh = fittingHouses(s).length;
  $("housecount").textContent = `${nh} house${nh === 1 ? "" : "s"} fit`;
  $("housecount").className = "count" + (nh ? "" : " none");
  $("groupsum").innerHTML = `<b>${esc(describe(s.group))}</b>` +
    ` · ${cars(p)} ${cars(p) === 1 ? "car" : "cars"} or ${Math.ceil(p / 8)} transfer ${Math.ceil(p / 8) === 1 ? "vehicle" : "vehicles"}`;
}

export function renderDests(s: State) {
  const sel = s.dest;
  $("dests").innerHTML = `<button type="button" class="chip all" data-r="" aria-pressed="${!sel.length}">All</button>` +
    RESORTS_FILE.resorts.map((r) => {
      const n = r.airports.length;
      return `<button type="button" class="chip" data-r="${esc(r.id)}" aria-pressed="${sel.includes(r.id)}">${esc(r.name)}${n > 1 ? ` <small>${n} airports</small>` : ""}</button>`;
    }).join("");
  $("destcount").textContent = sel.length ? `· ${sel.length} of ${RESORTS_FILE.resorts.length} chosen` : "· all";
  document.querySelectorAll<HTMLTableRowElement>("#cmpbody tr").forEach((tr) => { tr.hidden = !picked(s, tr.dataset.resort!); });
}

/** Resort events written like "Snowbombing 5–10 Apr" or "Carnival (9 Feb)", if their dates touch the stay. */
function eventsDuring(s: State, w: number): string[] {
  const r = dates(s, w), out: string[] = [];
  for (const res of RESORTS_FILE.resorts) {
    if (!picked(s, res.id)) continue;
    const ev = SEASON.resorts[res.id]?.events || "";
    for (const m of ev.matchAll(/(\d{1,2})(?:–(\d{1,2}))? (Jan|Feb|Mar|Apr)/g)) {
      const mon = MONTHS.indexOf(m[3]), y = r.a.getUTCFullYear();
      const from = Date.UTC(y, mon, +m[1]), to = Date.UTC(y, mon, +(m[2] || m[1]));
      if (from <= r.b.getTime() && to >= r.a.getTime()) { out.push(`${res.name}: ${ev}`); break; }
    }
  }
  return out;
}

/** The selected week, under the grid: demand, leave, and a few tips for the chosen resorts. */
export function renderWeeks(s: State) {
  const w = s.week, r = dates(s, w), L = weekLevel(SEASON, w), soft = softHoliday(SEASON, s.pattern, w, s.days), ld = leaveDays(SEASON, s.pattern, w, s.days);
  const opts = visible(s);
  const cheapest = (wk: number) => opts.filter((d) => !shut(s, d, wk)).map((d) => ({ d, pp: c(s, d, wk).pp })).sort((x, y) => x.pp - y.pp)[0];
  const now = cheapest(w);
  const tips: string[] = [];
  if (now) tips.push(`Cheapest this week: <b>${esc(now.d.name)}</b> via ${esc(now.d.code)}, ${euro(now.pp)} per person.`);
  const better = SEASON.weeks.map((_, i) => ({ i, x: cheapest(i) })).filter((y) => y.x && y.i !== w).sort((p, q) => p.x!.pp - q.x!.pp)[0];
  if (now && better && now.pp - better.x!.pp >= 20)
    tips.push(`Cheaper week: <button type="button" class="linkbtn" data-w="${better.i}">${esc(dates(s, better.i).text)}</button> saves ${euro(now.pp - better.x!.pp)} per person (${esc(better.x!.d.name)}).`);
  else if (now) tips.push("This is the cheapest week for the resorts you chose.");
  for (const e of eventsDuring(s, w)) tips.push(`Event: ${esc(e)}.`);
  const closed = opts.filter((d) => shut(s, d, w));
  const closedResorts = [...new Set(closed.map((d) => d.name))];
  if (closedResorts.length) tips.push(`Closed by your return day: ${closedResorts.map(esc).join(", ")}.`);
  if (late(SEASON, w)) {
    const good = RESORTS_FILE.resorts.filter((x) => picked(s, x.id) && x.spring === "good" && !closedResorts.includes(x.name)).map((x) => x.name);
    const list = good.length > 1 ? good.slice(0, -1).join(", ") + " and " + good[good.length - 1] : good[0];
    tips.push(`Late season: the snow can be thin low down${good.length ? `; ${esc(list)} ${good.length > 1 ? "are" : "is"} the safest bet` : ""}.`);
  }
  $("weekinfo").innerHTML = `<b>${esc(r.text)} ${r.a.getUTCFullYear()} · ${LEVELS[L]} · ${ld} days of leave</b><span class="foot">${esc(SEASON.weekNotes[w])}` +
    (soft ? " " + esc(soft.note) : "") + (ld < 4 + extraNights(s.days) ? ` With the public holiday, this stay only uses ${ld} days of leave.` : "") + `</span>` +
    (tips.length ? `<ul class="tips">${tips.map((x) => `<li>${x}</li>`).join("")}</ul>` : "");
}

/** Groups items by key, keeping the order in which keys first appear. */
function groupBy<T>(xs: T[], key: (x: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const x of xs) { const k = key(x); m.set(k, [...(m.get(k) || []), x]); }
  return [...m];
}

export function renderHeat(s: State) {
  const areas = groupBy(visible(s), (d) => d.region).map(([name, opts]) => {
    const weeks = SEASON.weeks.map((_, w) => {
      const open = opts.filter((d) => !shut(s, d, w)).map((d) => ({ d, pp: c(s, d, w).pp })).sort((a, b) => a.pp - b.pp);
      return open.length ? { lo: open[0], hi: open[open.length - 1], n: open.length, closed: opts.length - open.length } : null;
    });
    return { name, opts, weeks };
  });
  const all = areas.flatMap((a) => a.weeks.flatMap((x) => (x ? [x.lo.pp] : [])));
  const mn = Math.min(...all), mx = Math.max(...all);
  const bucket = (v: number) => { if (mx === mn) return 0; const t = (v - mn) / (mx - mn); return t < .25 ? 0 : t < .5 ? 1 : t < .75 ? 2 : 3; };
  $("heathead").innerHTML = `<tr><th>${sortBtn("Area")}</th>` + SEASON.weeks.map((_, w) => {
    const r = dates(s, w);
    return `<th class="${w === s.week ? "sel" : ""}" style="text-align:center">${sortBtn(fmt(r.a) + "<br>" + fmt(r.b))}</th>`;
  }).join("") + "</tr>";
  $("heatbody").innerHTML = areas.map(({ name, opts, weeks }) => {
    const open = weeks.filter((x) => x != null).map((x) => x!.lo.pp);
    const best = open.length ? weeks.findIndex((x) => x?.lo.pp === Math.min(...open)) : -1;
    const nResorts = new Set(opts.map((d) => d.resort)).size;
    return `<tr><td class="dest" data-v="${esc(name)}"><b>${esc(name)}</b><small>${nResorts} resort${nResorts > 1 ? "s" : ""} · ${opts.length} flight option${opts.length > 1 ? "s" : ""}</small></td>` + weeks.map((x, w) => {
      const sel = w === s.week ? " selcol" : "";
      const when = dates(s, w).text;
      if (!x) return `<td class="cell closed${sel}" tabindex="0" data-w="${w}" data-v="closed" title="${esc(name)}: every resort is closed for ${esc(when)}">Closed</td>`;
      const thin = late(SEASON, w) && opts.some((d) => !shut(s, d, w) && d.spring === "poor");
      const tip = `${name}, ${when}: from ${euro(x.lo.pp)} (${x.lo.d.name} via ${x.lo.d.code}) to ${euro(x.hi.pp)} (${x.hi.d.name} via ${x.hi.d.code}) per person` +
        (x.closed ? `. ${x.closed} option${x.closed > 1 ? "s" : ""} closed` : "");
      return `<td class="cell h${bucket(x.lo.pp)}${w === best ? " best" : ""}${sel}${thin ? " thin" : ""}" tabindex="0" data-w="${w}" data-v="${x.lo.pp.toFixed(2)}" title="${esc(tip)}">` +
        `<b>${euro(x.lo.pp)}</b>${Math.round(x.hi.pp) > Math.round(x.lo.pp) ? `<small>to ${euro(x.hi.pp)}</small>` : ""}</td>`;
    }).join("") + "</tr>";
  }).join("");
  applySort(s, "heat");
}

function stayPill(s: State, k: Calc) {
  const st = k.stay;
  if (st.source === "edited") return `<span class="pill p-neutral">Your house price</span>`;
  if (st.source === "houses") return `<span class="pill p-ok">${LEVEL_LABEL[s.house]} house · ${st.houses.eligible.length} listed</span>`;
  if (st.source === "few") return `<span class="pill p-warn">${st.houses.eligible.length} house${st.houses.eligible.length > 1 ? "s" : ""} listed</span>`;
  return `<span class="pill p-neutral">House price estimated</span>`;
}
function pills(s: State, d: Option, k: Calc, w: number) {
  const L = level(SEASON, d.mkt, w);
  let h = d.mins <= 125 ? `<span class="pill p-ok">Transfer ≤ 2h</span>` : `<span class="pill ${d.mins <= 165 ? "p-warn" : "p-bad"}">Transfer ${esc(d.time.replace("~", ""))}</span>`;
  h += stayPill(s, k);
  h += `<span class="pill ${["p-ok", "p-neutral", "p-warn", "p-bad"][L]}">${LEVELS[L]}</span>`;
  h += `<span class="pill p-neutral">Après ${stars(d.apres)}</span>`;
  if (late(SEASON, w) && d.spring !== "good") h += `<span class="pill ${d.spring === "poor" ? "p-bad" : "p-warn"}">Spring snow ${d.spring === "poor" ? "weak" : "uncertain"}</span>`;
  if (d.flag) h += `<span class="pill p-warn">${esc(d.flag)}</span>`;
  return h;
}

// Which ranking groups are expanded ("a:<area>", "r:<resort id>"). Kept across re-renders, not saved.
export const rankOpen = new Set<string>();
let rankSeeded = false;

export function renderRank(s: State, repo: string) {
  const w = s.week;
  $("rankTitle").innerHTML = `<span class="step">3</span>Flights and others · ${esc(dates(s, w).text)}`;
  const closed = visible(s).filter((d) => shut(s, d, w));
  const rows = visible(s).filter((d) => !shut(s, d, w)).map((d) => ({ d, k: c(s, d, w) })).sort((a, b) => a.k.pp - b.k.pp);
  const max = Math.max(...rows.map((r) => r.k.pp), 1);
  const colors: Record<string, string> = { flight: "var(--c-flight)", ground: "var(--c-ground)", stay: "var(--c-stay)", pass: "var(--c-pass)", rent: "var(--c-rent)", food: "var(--c-food)", lesson: "var(--c-lesson)" };
  const labels: Record<string, string> = { flight: "Flight", ground: s.ground === "car" ? "Car" : s.ground === "transfer" ? "Transfer" : "Car / transfer", stay: "House", pass: "Lift pass", rent: "Rental", food: "Food", lesson: "Lessons (group average)" };
  type R = (typeof rows)[number];
  // "4h15 total (2h15 flight + 2h by road)"; road time alone when the flight time is unknown.
  const trip = (d: Option) => {
    const f = SEASON.flightTimes[d.code];
    return f ? `${hm(f.mins + d.mins)} total (${hm(f.mins)} flight${f.stops ? ", 1 stop" : ""} + ${hm(d.mins)} by road)` : `${esc(d.time.replace("~", ""))} by road`;
  };
  const bar = ({ d, k }: R, label: string) => `<div class="bar" role="img" aria-label="${esc(label)}: ${euro(k.pp)} per person">` +
    (Object.keys(k.parts) as (keyof typeof k.parts)[]).map((p) =>
      `<span title="${labels[p]}: ${euro(k.parts[p])}" style="width:${((k.parts[p] / max) * 100).toFixed(2)}%;background:${colors[p]}"></span>`).join("") + "</div>";
  const tot = (xs: R[]) => {
    const lo = xs[0].k, hi = xs[xs.length - 1].k;
    return `<div class="tot num">${xs.length > 1 ? "<small>from</small>" : ""}<b>${euro(lo.pp)}</b><small>${xs.length > 1 && Math.round(hi.pp) > Math.round(lo.pp) ? `to ${euro(hi.pp)}` : `${euro(lo.group)} group`}</small></div>`;
  };
  // Under its resort a flight row is named by airport; on its own (one-airport resort) by resort.
  // With your house picked at this resort, each flight row lets you choose that flight for the trip.
  const mine = s.pick ? LISTINGS.find((l) => l.id === s.pick) : undefined;
  const myFlight = mine ? allIn(s, mine, w)?.best.d.id : undefined;
  const flyBtn = (d: Option) => mine && mine.resort === d.resort
    ? `<button type="button" class="btn${myFlight === d.id ? "" : " secondary"} flypick" data-act="pick-air" data-air="${esc(d.id)}" aria-pressed="${myFlight === d.id}">${myFlight === d.id ? "✓ Your flight" : "Fly this way"}</button>` : "";
  const flight = (x: R, underResort = false) => `<div class="row opt"><div class="who">` +
    (underResort ? `<b>✈ ${esc(x.d.air)}</b><small>${trip(x.d)} to ${esc(x.d.name)} · ${x.d.km} km</small>`
      : `<b>${esc(x.d.name)}</b><small>via ${esc(x.d.air)} · ${trip(x.d)} · ${x.d.km} km · ${esc(x.d.alt)}</small>`) +
    `<div class="tags">${pills(s, x.d, x.k, w)}</div>${flyBtn(x.d)}</div>` +
    bar(x, `${x.d.name} via ${x.d.air}`) + tot([x]) + "</div>";
  const group = (key: string, cls: string, who: string, xs: R[], label: string, kids: string) =>
    `<details class="grp ${cls}" data-k="${esc(key)}"${rankOpen.has(key) ? " open" : ""}><summary class="row"><div class="who">${who}</div>${bar(xs[0], label)}${tot(xs)}</summary><div class="kids">${kids}</div></details>`;

  const areas = groupBy(rows, (x) => x.d.region);
  if (!rankSeeded && areas.length) { rankOpen.add("a:" + areas[0][0]); rankSeeded = true; }
  $("rank").innerHTML = areas.map(([area, xs]) => {
    const resorts = groupBy(xs, (x) => x.d.resort);
    const best = xs[0].d;
    const who = `<b>${esc(area)}</b><small>${resorts.length} resort${resorts.length > 1 ? "s" : ""} · ${xs.length} flight option${xs.length > 1 ? "s" : ""} · cheapest: ${esc(best.name)} via ${esc(best.code)}</small>`;
    const kids = resorts.map(([id, ys]) => {
      const r = RESORT_BY_ID[id], b = ys[0].d, hs = ys[0].k.stay.houses;
      const nh = hs.eligible.length;
      const rwho = `<b>${esc(r.name)}</b><small>${esc(r.area)} · ${esc(b.alt)} · ${ys.length > 1 ? `${ys.length} airports, cheapest via ${esc(b.air)}` : `via ${esc(b.air)}`} · ${nh ? `${nh} house${nh > 1 ? "s" : ""}` : "no houses listed"}</small>`;
      return group("r:" + id, "g-resort", rwho, ys, `${r.name}, cheapest via ${b.air}`, resortHouses(s, r, hs, repo) + ys.map((y) => flight(y, true)).join(""));
    }).join("");
    return group("a:" + area, "g-area", who, xs, `${area}, cheapest ${best.name} via ${best.air}`, kids);
  }).join("") || `<p class="foot">No resort matches the filter.</p>`;
  if (closed.length) $("rank").insertAdjacentHTML("beforeend", `<p class="foot" style="padding-top:10px">Closed this week: ${closed.map((d) => `${esc(d.name)} via ${esc(d.air)} (closes ${esc(closeTxt(d))})`).join(", ")}.</p>`);
}

// ---- houses
const HOUSE_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 52h48M14 52V28l18-14 18 14v24M26 52V38h12v14" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M4 30 32 8l28 22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;
function sourceName(l: Listing) {
  const h = (() => { try { return new URL(l.url).hostname; } catch { return ""; } })();
  return /airbnb\./.test(h) ? "Airbnb" : /booking\./.test(h) ? "Booking.com" : /vrbo\./.test(h) ? "Vrbo" : h.replace(/^www\./, "") || "listing";
}
/** week: set in the all-dates view, the week this price is for (shown, and used when the house is chosen). */
function card(s: State, x: Priced, label: string, selected: boolean, week?: number) {
  const l = x.l, src = sourceName(l), trip = allIn(s, l, week ?? s.week);
  const qa = new Date(x.quote.checkin), qb = new Date(x.quote.checkout);
  const dates = qa.getUTCMonth() === qb.getUTCMonth() ? `${qa.getUTCDate()}–${fmt(qb)}` : `${fmt(qa)} – ${fmt(qb)}`;
  const nq = l.quotes.length;
  const photo = l.photo
    ? `<img src="${esc(l.photo)}" alt="${esc(l.title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span class="credit">Photo: ${esc(src)}</span>`
    : `<span class="ph">${HOUSE_SVG}</span>`;
  const facts = [`${l.bedrooms} bedroom${l.bedrooms > 1 ? "s" : ""}`, ...(l.beds ? [`${l.beds} beds`] : []), `sleeps ${l.sleeps}`];
  const lift = l.toLiftM == null ? `<span class="lift unk">Distance to lifts unknown</span>`
    : `<span class="lift${nearLifts(l) ? " ok" : ""}">${l.toLiftM <= 100 ? "Ski in / ski out" : `${walkMins(l.toLiftM)} min walk to the lifts`} · ${l.toLiftM >= 1000 ? `${(l.toLiftM / 1000).toFixed(1)} km` : `${l.toLiftM} m`}</span>`;
  if (l.rating != null) facts.push(`★ ${l.rating.toFixed(1)}/10`);
  const resortName = RESORT_BY_ID[l.resort]?.name || "";
  const where = l.lat != null ? `${l.lat},${l.lng}` : `${l.title}, ${resortName}`;
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(where)}`;
  // Streets wind: a walk is roughly 1.3× the straight line.
  const walkM = l.lift ? Math.max(10, Math.round((l.lift.m * 1.3) / 10) * 10) : 0;
  const liftLine = l.lift
    ? `<span class="nlift">🚡 Nearest lift${l.lift.name ? `: ${esc(l.lift.name)}` : ""} · ≈ ${walkM >= 1000 ? `${(walkM / 1000).toFixed(1)} km` : `${walkM} m`} walk (${walkMins(walkM)} min)${l.locApprox ? " · approx. location" : ""}</span>` : "";
  const routeUrl = l.lift && l.lat != null
    ? `https://www.google.com/maps/dir/?api=1&origin=${l.lat},${l.lng}&destination=${l.lift.lat},${l.lift.lng}&travelmode=walking` : "";
  const mapLinks = `<span class="maplinks"><a href="${esc(mapUrl)}" target="_blank" rel="noopener noreferrer">📍 Map</a>` +
    (routeUrl ? `<a href="${esc(routeUrl)}" target="_blank" rel="noopener noreferrer">Walking route to the lift ↗</a>` : "") + `</span>`;
  return `<article class="hcard${selected || s.pick === l.id ? " sel" : ""}" role="listitem">` +
    `<a class="hphoto" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">${photo}<span class="tier">${esc(label)}</span>${l.rating != null ? `<span class="hrate" aria-label="Rated ${l.rating.toFixed(1)} out of 10">★ ${l.rating.toFixed(1)}</span>` : ""}</a>` +
    `<div class="hbody"><span class="ttl">${esc(l.title)}</span>${lift}${liftLine}<small>${esc(facts.join(" · "))}</small>${mapLinks}` +
    (week != null ? `<span class="cheapwk">📅 Cheapest week: ${esc(seasonRange(SEASON, s.pattern, week, s.days).text)}</span>` : "") +
    `<div class="hprice"><b>${euro(x.pp)}</b><small>per person, house only · ${euro(x.total)} for the house</small></div>` +
    (trip ? `<small class="allin">≈ <b>${euro(trip.best.pp)}</b> per person all in, flying to ${esc(trip.best.d.code)} (flight, ${trip.best.groundKind}, house, pass, rental, food)</small>` : "") +
    `<small>Quote for ${dates}${nq > 1 ? ` (+${nq - 1} more)` : ""}${x.exact ? "" : ", adjusted to this week's demand"}${l.notes ? " · " + esc(l.notes) : ""}</small>` +
    `<div class="hacts"><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">View on ${esc(src)} ↗</a>` +
    `<button type="button" class="choose" data-pick="${esc(l.id)}" data-week="${week ?? s.week}"${x.exact ? ` data-checkin="${esc(x.quote.checkin)}" data-nights="${x.quote.nights}"` : ""} aria-pressed="${s.pick === l.id}">${s.pick === l.id ? "✓ Your pick" : "Choose this house"}</button></div></div></article>`;
}
function searchLinks(r: Resort, s: State) {
  const rg = dates(s, s.week), ci = isoOf(rg.a), co = isoOf(rg.b), p = people(s.group), b = bedrooms(s.group);
  const q = r.searchName || `${r.name}, ${r.country}`;
  const air = `https://www.airbnb.com/s/${encodeURIComponent(q)}/homes?checkin=${ci}&checkout=${co}&adults=${p}&min_bedrooms=${b}`;
  const bk = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(q)}&checkin=${ci}&checkout=${co}&group_adults=${p}&group_children=0&no_rooms=1&nflt=${encodeURIComponent("entire_place_bedroom_count=" + b)}`;
  return `<a href="${esc(air)}" target="_blank" rel="noopener">Airbnb ↗</a> · <a href="${esc(bk)}" target="_blank" rel="noopener">Booking ↗</a>`;
}

const liftText = (s: State) => { const t = LIFT_BANDS[s.liftBand || "all"].text; return t ? `, ${t}` : ""; };
/** The houses carousel inside a resort's dropdown in the ranking: every fitting house, cheapest first,
 *  labelled with its level; the level picked above is highlighted and sets the house cost. */
function resortHouses(s: State, r: Resort, h: HouseResult, repo: string) {
  const p = people(s.group), b = bedrooms(s.group);
  const need = `${s.group.soloRooms === "twin" ? `${p} separate beds` : `${b}+ bedroom${b > 1 ? "s" : ""}, sleeps ${p}`}${liftText(s)}`;
  const add = `https://github.com/${repo}/blob/main/CONTRIBUTING.md#add-a-house`;
  if (h.mode === "none") {
    const all = LISTINGS_BY_RESORT[r.id] || [];
    const why = all.length ? ` (${all.length} listed, none fit${s.liftBand && s.liftBand !== "all" ? " or close enough to the lifts" : ""})` : "";
    return `<div class="hres hempty"><span class="foot">No houses listed yet for ${need}${why}, so the house price is an estimate. Search ${searchLinks(r, s)} · <a href="${esc(add)}" target="_blank" rel="noopener">add one</a></span></div>`;
  }
  const tierOf = new Map<Priced, Tier>();
  if (h.mode === "tiers") for (const tr of h.tiers) for (const x of tr.listings) tierOf.set(x, tr.tier);
  const head = h.mode === "tiers"
    ? `${h.eligible.length} houses fit (${need}) · per person: ` + h.tiers.map((tr) => `<span class="${tr.tier === s.house ? "on" : ""}">${TIER_LABEL[tr.tier]} <b>${euro(tr.medianPP)}</b></span>`).join(" · ")
    : `Only ${h.eligible.length} fitting house${h.eligible.length > 1 ? "s" : ""} (${need}); levels need 3 · find more: ${searchLinks(r, s)}`;
  const cards = h.eligible.filter((x) => s.house === "all" || tierOf.get(x) === s.house).map((x) => {
    const tr = tierOf.get(x);
    return card(s, x, tr ? TIER_LABEL[tr] : "Listed", tr === s.house);
  }).join("");
  return `<div class="hres"><div class="hres-head"><b>Houses</b><span class="foot">${head}</span></div>` +
    `<div class="hcards" role="list" aria-label="Houses in ${esc(r.name)}">${cards}</div></div>`;
}

// ---- detail table
export function renderTable(s: State) {
  const w = s.week, p = people(s.group);
  $("tbody").innerHTML = OPTIONS.filter((d) => picked(s, d.resort)).map((d) => {
    const k = c(s, d, w);
    const inp = (f: Field, value?: number) => {
      const isEd = edited(s, d, f, w) != null;
      const v = value ?? val(SEASON, s, d, f, w);
      return `<input type="number" min="0" step="5" id="in-${d.id}-${f}" data-id="${d.id}" data-f="${f}" value="${Math.round(v)}"${isEd ? ` class="edited" title="Your value for this week"` : ""} aria-label="${f} ${esc(d.name)} ${esc(d.air)}">`;
    };
    const pf = ("pass" + s.days) as Field, rf = ("rent" + s.days) as Field;
    const closed = shut(s, d, w);
    const dim = closed ? ` class="dimrow"` : "";
    const nCars = cars(p), tf = transferFactor(p);
    const stayNote = { edited: "your price", houses: `${LEVEL_LABEL[s.house].toLowerCase()} houses`, few: "few houses", estimate: `estimate, ${bedrooms(s.group)} bedrooms` }[k.stay.source];
    return `<tr${dim}><td class="dest" data-v="${esc(d.name + " " + d.air)}"><b>${esc(d.name)}</b><small>${esc(d.country)} · ${esc(d.air)}${closed ? ` · <span style="color:var(--bad)">closed (closes ${esc(closeTxt(d))})</span>` : ""}</small></td><td data-v="${d.km}">${esc(d.time)}<br><small class="foot">${d.km} km</small></td>` +
      `<td class="r">${inp("flight")}</td>` +
      `<td class="r">${inp("car")}<br><small class="foot">× ${nCars} = ${euro(val(SEASON, s, d, "car", w) * nCars)}</small></td>` +
      `<td class="r">${inp("transfer")}<br><small class="foot">× ${+tf.toFixed(2)} = ${euro(val(SEASON, s, d, "transfer", w) * tf)}</small></td>` +
      `<td class="r">${inp("stay", k.stayTotal)}<br><small class="foot">${stayNote}</small></td>` +
      `<td class="r">${inp(pf)}${d.passEst ? `<br><small class="foot">estimated</small>` : ""}</td><td class="r">${inp(rf)}</td>` +
      `<td class="r num" data-v="${k.parts.food}">${euro(k.parts.food)}<br><small class="foot">${euro(foodPerDay(s, d))} × ${foodDays(SEASON, s.days)} days</small></td>` +
      `<td class="r num total" data-v="${closed ? "closed" : k.pp}">${closed ? "Closed" : euro(k.pp)}</td><td class="r num" data-v="${closed ? "closed" : k.group}">${closed ? "–" : euro(k.group)}</td></tr>`;
  }).join("");
  applySort(s, "detail");
}


// ---- the Houses section: every house that fits the group at the chosen resorts, for the chosen week
export type HouseView = "price" | "distance";
interface Found { x: Priced; r: Resort; tier?: Tier }
/** Fitting houses at the picked resorts (the lift-distance tick applies), cheapest first. */
export function fittingHouses(s: State): Found[] {
  const out: Found[] = [];
  for (const r of RESORTS_FILE.resorts) {
    const d = visible(s).filter((o) => o.resort === r.id)[0];
    if (!d) continue;
    const h = c(s, d, s.week).stay.houses;
    const tierOf = new Map<Priced, Tier>();
    if (h.mode === "tiers") for (const t of h.tiers) for (const x of t.listings) tierOf.set(x, t.tier);
    for (const x of h.eligible) out.push({ x, r, tier: tierOf.get(x) });
  }
  return out.sort((a, b) => a.x.pp - b.x.pp);
}
/** How many trips the site priced for this group across all resorts (the resort and travel-time filters
 *  are ignored): every fitting house × week × start day × flight there, closed weeks skipped. The headline
 *  number in the WhatsApp message. */
export function combinations(s: State): number {
  let n = 0;
  for (const pattern of Object.keys(SEASON.patterns) as PatternKey[]) {
    const t = { ...s, pattern };
    SEASON.weeks.forEach((_, w) => {
      for (const d of OPTIONS) {
        if (shut(t, d, w)) continue;
        n += houses(SEASON, d.mkt, LISTINGS_BY_RESORT[d.resort] || [], s.group, w, s.liftBand, nights(SEASON, s.days)).eligible.length;
      }
    });
  }
  return n;
}
/** Every fitting house at its cheapest week of the season (closed weeks skipped), cheapest first. */
export function fittingHousesAllDates(s: State): (Found & { week: number })[] {
  const best = new Map<string, Found & { week: number }>();
  SEASON.weeks.forEach((_, w) => {
    for (const r of RESORTS_FILE.resorts) {
      const d = visible(s).filter((o) => o.resort === r.id && !shut(s, o, w))[0];
      if (!d) continue;
      const h = c(s, d, w).stay.houses;
      const tierOf = new Map<Priced, Tier>();
      if (h.mode === "tiers") for (const t of h.tiers) for (const x of t.listings) tierOf.set(x, t.tier);
      for (const x of h.eligible) {
        const had = best.get(x.l.id);
        if (!had || x.pp < had.x.pp) best.set(x.l.id, { x, r, week: w, tier: tierOf.get(x) });
      }
    }
  });
  return [...best.values()].sort((a, b) => a.x.pp - b.x.pp);
}
const DIST = [
  { label: "Ski in / ski out", hint: "100 m or less", max: 100 },
  { label: "Up to 5 min walk", hint: "up to ~375 m", max: 375 },
  { label: "5–10 min walk", hint: "up to ~750 m", max: 750 },
  { label: "Further: shuttle or car", hint: "more than 10 min, or not stated", max: Infinity },
];
/** allDates: no week picked yet, so each house shows its cheapest week of the season. */
export function renderHouseSection(s: State, view: HouseView, repo: string, allDates = false) {
  $("houseView").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === view)));
  const all: (Found & { week?: number })[] = (allDates ? fittingHousesAllDates(s) : fittingHouses(s)).filter((f) => s.house === "all" || f.tier === s.house);
  const p = people(s.group), b = bedrooms(s.group);
  const resorts = new Set(all.map((f) => f.r.id)).size;
  const fit = `${all.length} house${all.length > 1 ? "s" : ""} in ${resorts} resort${resorts > 1 ? "s" : ""} fit${all.length === 1 ? "s" : ""} ${p} people ${s.group.soloRooms === "twin" ? "with a bed each" : `in ${b}+ bedrooms`}${liftText(s)}${s.house === "all" ? "" : `, ${LEVEL_LABEL[s.house].toLowerCase()} level`}`;
  $("houseslede").innerHTML = !all.length ? ""
    : allDates ? `${esc(fit)}, across all dates: each shows its cheapest week. Tap a week in the grid below to price that week. Prices are per person for the whole stay.`
    : `${esc(fit)}, for ${esc(dates(s, s.week).text)}. <button type="button" class="linkbtn" data-act="all-dates">Show all dates</button>`;
  if (!all.length) {
    const add = `https://github.com/${repo}/blob/main/CONTRIBUTING.md#add-a-house`;
    $("housegroups").innerHTML = `<div class="hempty-big"><b>No houses fit yet.</b><span class="foot">${s.liftBand && s.liftBand !== "all" || s.house !== "all" ? `Try “All” for the walk to the lifts or the house level in Filters, or pick other resorts.` : "Pick other resorts in Filters."} Found one? <a href="${esc(add)}" target="_blank" rel="noopener">Add it</a>.</span></div>`;
    return;
  }
  let groups: { title: string; hint: string; xs: (Found & { week?: number })[] }[];
  if (view === "price") {
    const n = all.length, k = n >= 3 && s.house === "all" ? 3 : 1;
    const names = k === 3 ? ["Budget", "Mid", "Luxury"] : [s.house === "all" ? "All" : LEVEL_LABEL[s.house]];
    groups = names.map((title, i) => {
      const xs = all.filter((_, j) => Math.floor((k * j) / n) === i);
      return { title, hint: xs.length ? `${euro(xs[0].x.pp)}–${euro(xs[xs.length - 1].x.pp)} per person` : "", xs };
    });
  } else {
    groups = DIST.map((g, i) => ({ title: g.label, hint: g.hint, xs: all.filter((f) => {
      const m = f.x.l.toLiftM ?? Infinity;
      return m <= g.max && (i === 0 || m > DIST[i - 1].max);
    }) }));
  }
  $("housegroups").innerHTML = groups.filter((g) => g.xs.length).map((g) =>
    `<div class="hgroup"><h3>${esc(g.title)} <small>${g.xs.length} · ${esc(g.hint)}</small></h3>` +
    `<div class="hcards" role="list" aria-label="${esc(g.title)}">` +
    g.xs.map((f) => card(s, f.x, f.r.name, false, f.week)).join("") + `</div></div>`).join("");
}

/** The pinned bar's summary: your pick's resort and price, or the cheapest resort this week ("from"). */
export function renderQuickSum(s: State) {
  const p = pickSummary(s);
  if (p) { $("qbsum").innerHTML = `<span class="qb-res">📍 ${esc(p.resort.name)}</span><b class="qb-pp num">${euro(p.pp)}</b>`; $("qbsum").className = "qb-sum set"; return; }
  const best = visible(s).filter((d) => !shut(s, d, s.week)).map((d) => ({ d, pp: c(s, d, s.week).pp })).sort((a, b) => a.pp - b.pp)[0];
  $("qbsum").innerHTML = best ? `<span class="qb-res">📍 ${esc(best.d.name)}</span><b class="qb-pp num"><small>from</small> ${euro(best.pp)}</b>` : `<span class="qb-res">📍 —</span><b class="qb-pp">€ —</b>`;
  $("qbsum").className = "qb-sum";
}

// ---- a person's pick: one house, priced with the cheapest way there under the current settings
export interface PickSummary {
  listing: Listing; resort: Resort; option: Option; when: string; people: number;
  housePP: number; houseTotal: number; pp: number; group: number; walk: string;
  /** Every open way to fly there this week, cheapest first, priced all in with this house. */
  flights: { d: Option; pp: number; parts: Calc["parts"]; groundKind: Calc["groundKind"] }[];
  /** Per person cost of each part for the chosen flight, with this house. */
  parts: Calc["parts"];
  groundKind: Calc["groundKind"];
}
/** The trip all in with house l in week w: the flight you chose (s.air) if it flies there, else the cheapest. */
export function allIn(s: State, l: Listing, w: number) {
  const opts = OPTIONS.filter((d) => d.resort === l.resort && !shut(s, d, w));
  if (!opts.length) return null;
  const p = people(s.group);
  const house = priceFor(SEASON, opts[0].mkt, l, w, nights(SEASON, s.days)).total;
  const flights = opts.map((d) => { const k = c(s, d, w); return { d, pp: k.pp - k.parts.stay + house / p, parts: { ...k.parts, stay: house / p }, groundKind: k.groundKind }; }).sort((a, b) => a.pp - b.pp);
  return { house, flights, best: flights.find((f) => f.d.id === s.air) || flights[0] };
}
export function pickSummary(s: State): PickSummary | null {
  const l = s.pick ? LISTINGS.find((x) => x.id === s.pick) : undefined;
  const r = l && RESORT_BY_ID[l.resort];
  const a = l && allIn(s, l, s.week);
  if (!l || !r || !a) return null;
  const p = people(s.group), house = a.house, best = a.best;
  const walk = l.toLiftM == null ? "distance to lifts not stated" : l.toLiftM <= 100 ? "ski in / ski out" : `${walkMins(l.toLiftM)} min walk to the lifts`;
  return { listing: l, resort: r, option: best.d, when: dates(s, s.week).text, people: p, housePP: house / p, houseTotal: house, pp: best.pp, group: best.pp * p, walk, flights: a.flights, parts: best.parts, groundKind: best.groundKind };
}
