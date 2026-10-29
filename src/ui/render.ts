// Rendering. Ported from the original simulator's render* functions; text is now English and every
// "group of 4" is the group's real size. All data strings go through esc() — listings come from people.
import { LISTINGS, OPTIONS, RESORTS_FILE, RESORT_BY_ID, SEASON } from "../data.ts";
import { LEVELS, WDAYS, closeTxt, fmt, isClosed, isoOf, late, leaveDays, level, range, softHoliday, weekLevel } from "../model/calendar.ts";
import { calc, edited, foodPerDay, val, type Calc } from "../model/cost.ts";
import { bedrooms, cars, describe, people, transferFactor } from "../model/group.ts";
import { NEAR_LIFT_MIN, TIER_LABEL, nearLifts, walkMins, type HouseResult, type Priced } from "../model/houses.ts";
import type { Field, Listing, Option, Resort, Tier } from "../types.ts";
import type { State } from "../state.ts";
import { applySort, sortBtn } from "./sort.ts";

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
  if (!r) { r = calc(SEASON, s, d, w, LISTINGS_BY_RESORT[d.resort] || []); cache.set(k, r); }
  return r;
}

export function picked(s: State, resortId: string) { return !s.dest.length || s.dest.includes(resortId); }
export function visible(s: State) { return OPTIONS.filter((d) => (!s.limit || d.mins <= 125) && picked(s, d.resort)); }
function shut(s: State, d: Option, w: number) { return isClosed(SEASON, d, s.pattern, w); }

// ---- header bits that only depend on the season
export function renderStatic() {
  const o = SEASON.origin, first = range(SEASON, "thu", 0).a, last = range(SEASON, "thu", SEASON.weeks.length - 1).b;
  $("eyebrow").textContent = `Flying from ${o.city} (${o.code}) · ${SEASON.nights} nights including a weekend · ${fmt(first)} to ${fmt(last)} ${last.getUTCFullYear()}`;
  $("pattern").innerHTML = (Object.keys(SEASON.patterns) as (keyof typeof SEASON.patterns)[])
    .map((k) => `<button type="button" data-v="${k}">${esc(SEASON.patterns[k].label)}</button>`).join("");
  $("fooddays").textContent = String(SEASON.foodDays);
  $("origin").textContent = `${o.city} (${o.code})`;
  $("cmporigin").textContent = o.city;
  $("collected").textContent = `Season ${SEASON.season}. Estimates collected on ${fmt(new Date(SEASON.collected))} ${SEASON.collected.slice(0, 4)}. Check flights and houses with real dates before booking.`;
  $("fit").innerHTML = RESORTS_FILE.fit.map((f) =>
    `<div class="fitcard"><span class="tag" style="color:var(--${esc(f.tone)})">${esc(f.tag)}</span><b>${esc(RESORT_BY_ID[f.resort]?.name ?? f.resort)}</b><p>${esc(f.text)}</p></div>`).join("");
  $("fitfoot").textContent = RESORTS_FILE.fitFootnote;
  const src = SEASON.sources;
  const links = (xs: { label: string; url: string; note?: string }[]) =>
    xs.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)}</a>${x.note ? ": " + esc(x.note) : ""}`).join(" · ");
  $("cmpsources").innerHTML = `Fastest from ${esc(o.city)}: typical scheduled flight time plus the drive or shuttle, not counting check-in or baggage. Check the real schedule for your dates. ` +
    "Sources: " + links(src.compare || []);
  $("sources").innerHTML = [
    ["School-holiday calendars", src.calendars], ["Closing dates", src.closures], ["Events", src.events],
    ["Lift passes and rental", src.passes], ["Flights, transfers and parking", src.transport], ["Group lessons", src.lessons],
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
  const segs: [string, string][] = [["pattern", s.pattern], ["days", String(s.days)], ["ground", s.ground], ["house", s.house], ["soloRooms", s.group.soloRooms]];
  for (const [id, v] of segs) $(id).querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
  ($("limit") as HTMLInputElement).checked = s.limit;
  ($("nearLifts") as HTMLInputElement).checked = !!s.nearLifts;
  const setNum = (id: string, v: number) => { const el = $(id) as HTMLInputElement; if (document.activeElement !== el) el.value = String(v); };
  const plan = s.foodPlan || "custom";
  ($("foodPlan") as HTMLSelectElement).value = plan;
  ($("food") as HTMLInputElement).hidden = plan !== "custom";
  const perDay = OPTIONS.map((d) => foodPerDay(s, d));
  $("foodhint").textContent = plan === "custom" ? `× ${SEASON.foodDays} days, arrival to departure`
    : `${euro(Math.min(...perDay))}–${euro(Math.max(...perDay))} per person per day, by resort, × ${SEASON.foodDays} days`;
  setNum("food", s.food); setNum("beg", s.beg); setNum("couples", s.group.couples); setNum("solo", s.group.solo);
  ($("beg") as HTMLInputElement).max = String(people(s.group));
  const p = people(s.group);
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

export function renderWeeks(s: State) {
  $("weeks").innerHTML = SEASON.weeks.map((_, i) => {
    const r = range(SEASON, s.pattern, i), L = weekLevel(SEASON, i), ld = leaveDays(SEASON, s.pattern, i);
    const nShut = OPTIONS.filter((d) => shut(s, d, i)).length;
    return `<button type="button" class="wk" data-w="${i}" aria-pressed="${i === s.week}">` +
      `<b>${fmt(r.a)} – ${fmt(r.b)}</b><small>${WDAYS[r.a.getUTCDay()]} → ${WDAYS[r.b.getUTCDay()]} · ${ld}${softHoliday(SEASON, s.pattern, i) ? "*" : ""} days of leave</small>` +
      (nShut ? `<small class="shut">${nShut} options closed</small>` : "") +
      `<div class="lvl l${L}" aria-label="${LEVELS[L]}"><i></i><i></i><i></i><i></i></div></button>`;
  }).join("");
  const r = range(SEASON, s.pattern, s.week), L = weekLevel(SEASON, s.week), soft = softHoliday(SEASON, s.pattern, s.week), ld = leaveDays(SEASON, s.pattern, s.week);
  $("weekinfo").innerHTML = `<b>${esc(r.text)} ${r.a.getUTCFullYear()} · ${LEVELS[L]}</b><span class="foot">${esc(SEASON.weekNotes[s.week])}` +
    (soft ? " " + esc(soft.note) : "") + (ld < 4 ? ` With the public holiday, this stay only uses ${ld} days of leave.` : "") + `</span>`;
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
    const r = range(SEASON, s.pattern, w);
    return `<th class="${w === s.week ? "sel" : ""}" style="text-align:center">${sortBtn(fmt(r.a) + "<br>" + fmt(r.b))}</th>`;
  }).join("") + "</tr>";
  $("heatbody").innerHTML = areas.map(({ name, opts, weeks }) => {
    const open = weeks.filter((x) => x != null).map((x) => x!.lo.pp);
    const best = open.length ? weeks.findIndex((x) => x?.lo.pp === Math.min(...open)) : -1;
    const nResorts = new Set(opts.map((d) => d.resort)).size;
    return `<tr><td class="dest" data-v="${esc(name)}"><b>${esc(name)}</b><small>${nResorts} resort${nResorts > 1 ? "s" : ""} · ${opts.length} flight option${opts.length > 1 ? "s" : ""}</small></td>` + weeks.map((x, w) => {
      const sel = w === s.week ? " selcol" : "";
      const when = range(SEASON, s.pattern, w).text;
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
  if (st.source === "houses") return `<span class="pill p-ok">${TIER_LABEL[s.house]} house · ${st.houses.eligible.length} listed</span>`;
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
  $("rankTitle").textContent = "Ranking · " + range(SEASON, s.pattern, w).text;
  const closed = visible(s).filter((d) => shut(s, d, w));
  const rows = visible(s).filter((d) => !shut(s, d, w)).map((d) => ({ d, k: c(s, d, w) })).sort((a, b) => a.k.pp - b.k.pp);
  const max = Math.max(...rows.map((r) => r.k.pp), 1);
  const colors: Record<string, string> = { flight: "var(--c-flight)", ground: "var(--c-ground)", stay: "var(--c-stay)", pass: "var(--c-pass)", rent: "var(--c-rent)", food: "var(--c-food)", lesson: "var(--c-lesson)" };
  const labels: Record<string, string> = { flight: "Flight", ground: s.ground === "car" ? "Car" : "Transfer", stay: "House", pass: "Lift pass", rent: "Rental", food: "Food", lesson: "Lessons (group average)" };
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
  const flight = (x: R, underResort = false) => `<div class="row opt"><div class="who">` +
    (underResort ? `<b>✈ ${esc(x.d.air)}</b><small>${trip(x.d)} to ${esc(x.d.name)} · ${x.d.km} km</small>`
      : `<b>${esc(x.d.name)}</b><small>via ${esc(x.d.air)} · ${trip(x.d)} · ${x.d.km} km · ${esc(x.d.alt)}</small>`) +
    `<div class="tags">${pills(s, x.d, x.k, w)}</div></div>` +
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
function card(s: State, x: Priced, label: string, selected: boolean) {
  const l = x.l, src = sourceName(l);
  const qa = new Date(x.quote.checkin), qb = new Date(x.quote.checkout);
  const dates = qa.getUTCMonth() === qb.getUTCMonth() ? `${qa.getUTCDate()}–${fmt(qb)}` : `${fmt(qa)} – ${fmt(qb)}`;
  const nq = l.quotes.length;
  const photo = l.photo
    ? `<img src="${esc(l.photo)}" alt="${esc(l.title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span class="credit">Photo: ${esc(src)}</span>`
    : `<span class="ph">${HOUSE_SVG}</span>`;
  const facts = [`${l.bedrooms} bedroom${l.bedrooms > 1 ? "s" : ""}`, `sleeps ${l.sleeps}`];
  const lift = l.toLiftM == null ? `<span class="lift unk">Distance to lifts unknown</span>`
    : `<span class="lift${nearLifts(l) ? " ok" : ""}">${l.toLiftM <= 100 ? "Ski in / ski out" : `${walkMins(l.toLiftM)} min walk to the lifts`} · ${l.toLiftM >= 1000 ? `${(l.toLiftM / 1000).toFixed(1)} km` : `${l.toLiftM} m`}</span>`;
  if (l.rating != null) facts.push(`★ ${l.rating.toFixed(1)}/10`);
  return `<article class="hcard${selected ? " sel" : ""}" role="listitem">` +
    `<a class="hphoto" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">${photo}<span class="tier">${esc(label)}</span></a>` +
    `<div class="hbody"><span class="ttl">${esc(l.title)}</span>${lift}<small>${esc(facts.join(" · "))}</small>` +
    `<div class="hprice"><b>${euro(x.pp)}</b><small>per person · ${euro(x.total)} total</small></div>` +
    `<small>Quote for ${dates}${nq > 1 ? ` (+${nq - 1} more)` : ""}${x.exact ? "" : ", adjusted to this week's demand"}${l.notes ? " · " + esc(l.notes) : ""}</small>` +
    `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">View on ${esc(src)} ↗</a></div></article>`;
}
function searchLinks(r: Resort, s: State) {
  const rg = range(SEASON, s.pattern, s.week), ci = isoOf(rg.a), co = isoOf(rg.b), p = people(s.group), b = bedrooms(s.group);
  const q = r.searchName || `${r.name}, ${r.country}`;
  const air = `https://www.airbnb.com/s/${encodeURIComponent(q)}/homes?checkin=${ci}&checkout=${co}&adults=${p}&min_bedrooms=${b}`;
  const bk = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(q)}&checkin=${ci}&checkout=${co}&group_adults=${p}&group_children=0&no_rooms=1&nflt=${encodeURIComponent("entire_place_bedroom_count=" + b)}`;
  return `<a href="${esc(air)}" target="_blank" rel="noopener">Airbnb ↗</a> · <a href="${esc(bk)}" target="_blank" rel="noopener">Booking ↗</a>`;
}

/** The houses carousel inside a resort's dropdown in the ranking: every fitting house, cheapest first,
 *  labelled with its level; the level picked above is highlighted and sets the house cost. */
function resortHouses(s: State, r: Resort, h: HouseResult, repo: string) {
  const p = people(s.group), b = bedrooms(s.group);
  const need = `${b}+ bedroom${b > 1 ? "s" : ""}, sleeps ${p}${s.nearLifts ? `, ≤ ${NEAR_LIFT_MIN} min walk to the lifts` : ""}`;
  const add = `https://github.com/${repo}/blob/main/CONTRIBUTING.md#add-a-house`;
  if (h.mode === "none") {
    const all = LISTINGS_BY_RESORT[r.id] || [];
    const why = all.length ? ` (${all.length} listed, none fit${s.nearLifts ? " or close enough to the lifts" : ""})` : "";
    return `<div class="hres hempty"><span class="foot">No houses listed yet for ${need}${why}, so the house price is an estimate. Search ${searchLinks(r, s)} · <a href="${esc(add)}" target="_blank" rel="noopener">add one</a></span></div>`;
  }
  const tierOf = new Map<Priced, Tier>();
  if (h.mode === "tiers") for (const tr of h.tiers) for (const x of tr.listings) tierOf.set(x, tr.tier);
  const head = h.mode === "tiers"
    ? `${h.eligible.length} houses fit (${need}) · per person: ` + h.tiers.map((tr) => `<span class="${tr.tier === s.house ? "on" : ""}">${TIER_LABEL[tr.tier]} <b>${euro(tr.medianPP)}</b></span>`).join(" · ")
    : `Only ${h.eligible.length} fitting house${h.eligible.length > 1 ? "s" : ""} (${need}); levels need 3 · find more: ${searchLinks(r, s)}`;
  const cards = h.eligible.map((x) => {
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
    const dim = (s.limit && d.mins > 125) || closed ? ` class="dimrow"` : "";
    const nCars = cars(p), tf = transferFactor(p);
    const stayNote = { edited: "your price", houses: `${TIER_LABEL[s.house].toLowerCase()} houses`, few: "few houses", estimate: `estimate, ${bedrooms(s.group)} bedrooms` }[k.stay.source];
    return `<tr${dim}><td class="dest" data-v="${esc(d.name + " " + d.air)}"><b>${esc(d.name)}</b><small>${esc(d.country)} · ${esc(d.air)}${closed ? ` · <span style="color:var(--bad)">closed (closes ${esc(closeTxt(d))})</span>` : ""}</small></td><td data-v="${d.km}">${esc(d.time)}<br><small class="foot">${d.km} km</small></td>` +
      `<td class="r">${inp("flight")}</td>` +
      `<td class="r">${inp("car")}<br><small class="foot">× ${nCars} = ${euro(val(SEASON, s, d, "car", w) * nCars)}</small></td>` +
      `<td class="r">${inp("transfer")}<br><small class="foot">× ${+tf.toFixed(2)} = ${euro(val(SEASON, s, d, "transfer", w) * tf)}</small></td>` +
      `<td class="r">${inp("stay", k.stayTotal)}<br><small class="foot">${stayNote}</small></td>` +
      `<td class="r">${inp(pf)}${d.passEst ? `<br><small class="foot">estimated</small>` : ""}</td><td class="r">${inp(rf)}</td>` +
      `<td class="r num" data-v="${k.parts.food}">${euro(k.parts.food)}<br><small class="foot">${euro(foodPerDay(s, d))} × ${SEASON.foodDays} days</small></td>` +
      `<td class="r">${inp("lesson")}<br><small class="foot">${euro(val(SEASON, s, d, "lesson", w) * s.days * (+s.beg || 0))} group</small></td>` +
      `<td class="r num total" data-v="${closed ? "closed" : k.pp}">${closed ? "Closed" : euro(k.pp)}</td><td class="r num" data-v="${closed ? "closed" : k.group}">${closed ? "–" : euro(k.group)}</td></tr>`;
  }).join("");
  applySort(s, "detail");
}

