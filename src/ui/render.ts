// Rendering. Ported from the original simulator's render* functions; text is now English and every
// "group of 4" is the group's real size. All data strings go through esc() — listings come from people.
import { LISTINGS, OPTIONS, RESORTS_FILE, RESORT_BY_ID, SEASON } from "../data.ts";
import { LEVELS, WDAYS, closeTxt, fmt, isClosed, isoOf, late, leaveDays, level, range, softHoliday, weekLevel } from "../model/calendar.ts";
import { calc, val, edited, type Calc } from "../model/cost.ts";
import { bedrooms, cars, describe, people, transferFactor } from "../model/group.ts";
import { TIER_LABEL, type HouseResult, type Priced } from "../model/houses.ts";
import type { Field, Listing, Option, Resort } from "../types.ts";
import type { State } from "../state.ts";
import { applySort, sortBtn } from "./sort.ts";

const $ = (id: string) => document.getElementById(id)!;
export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
const EUR = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
export const euro = (n: number) => EUR.format(Math.round(n));
const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

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
  $("foodhint").textContent = `× ${SEASON.foodDays} days, arrival to departure`;
  $("fooddays").textContent = String(SEASON.foodDays);
  $("origin").textContent = `${o.city} (${o.code})`;
  $("collected").textContent = `Season ${SEASON.season}. Estimates collected on ${fmt(new Date(SEASON.collected))} ${SEASON.collected.slice(0, 4)}. Check flights and houses with real dates before booking.`;
  $("fit").innerHTML = RESORTS_FILE.fit.map((f) =>
    `<div class="fitcard"><span class="tag" style="color:var(--${esc(f.tone)})">${esc(f.tag)}</span><b>${esc(RESORT_BY_ID[f.resort]?.name ?? f.resort)}</b><p>${esc(f.text)}</p></div>`).join("");
  $("fitfoot").textContent = RESORTS_FILE.fitFootnote;
  const src = SEASON.sources;
  const links = (xs: { label: string; url: string; note?: string }[]) =>
    xs.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)}</a>${x.note ? ": " + esc(x.note) : ""}`).join(" · ");
  $("cmpsources").innerHTML = "Sources: " + links(src.compare || []);
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
    const [wl, wc] = WIND[cm.wind[0]];
    return `<tr data-resort="${esc(r.id)}"><td class="dest" data-v="${esc(r.name)}"><b>${esc(r.compareName || r.name)}</b><small>${esc(r.country)} · ${esc(r.area)} · ${esc(air)}</small></td>` +
      `<td>${st(cm.snow)}</td><td class="num">${esc(cm.temp[0])}<small>${esc(cm.temp[1])}</small></td>` +
      `<td class="num">${esc(cm.area[0])}<small>${esc(cm.area[1])}</small></td>` +
      `<td>${st(cm.beginners)}</td><td>${st(cm.snowboard)}</td><td>${st(cm.expert)}</td><td>${st(cm.apres)}</td>` +
      `<td class="num">${esc(cm.beer)}</td><td><span class="risk ${wc}">${wl}</span><small>${esc(cm.wind[1])}</small></td>` +
      `<td><small style="margin:0">${esc(cm.insurance)}</small></td><td><small style="margin:0">${esc(rs?.events || "")}</small></td></tr>`;
  }).join("");
}

export function renderControls(s: State) {
  const segs: [string, string][] = [["pattern", s.pattern], ["days", String(s.days)], ["ground", s.ground], ["house", s.house], ["soloRooms", s.group.soloRooms]];
  for (const [id, v] of segs) $(id).querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
  ($("limit") as HTMLInputElement).checked = s.limit;
  const setNum = (id: string, v: number) => { const el = $(id) as HTMLInputElement; if (document.activeElement !== el) el.value = String(v); };
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

export function renderHeat(s: State) {
  const rows = visible(s);
  const all: number[] = [];
  rows.forEach((d) => SEASON.weeks.forEach((_, w) => { if (!shut(s, d, w)) all.push(c(s, d, w).pp); }));
  const mn = Math.min(...all), mx = Math.max(...all);
  const bucket = (v: number) => { if (mx === mn) return 0; const t = (v - mn) / (mx - mn); return t < .25 ? 0 : t < .5 ? 1 : t < .75 ? 2 : 3; };
  $("heathead").innerHTML = `<tr><th>${sortBtn("Resort")}</th>` + SEASON.weeks.map((_, w) => {
    const r = range(SEASON, s.pattern, w);
    return `<th class="${w === s.week ? "sel" : ""}" style="text-align:center">${sortBtn(fmt(r.a) + "<br>" + fmt(r.b))}</th>`;
  }).join("") + "</tr>";
  $("heatbody").innerHTML = rows.map((d) => {
    const vals = SEASON.weeks.map((_, w) => (shut(s, d, w) ? null : c(s, d, w).pp));
    const open = vals.filter((v): v is number => v != null);
    const best = open.length ? vals.indexOf(Math.min(...open)) : -1;
    return `<tr><td class="dest" data-v="${esc(d.name + " " + d.air)}"><b>${esc(d.name)}</b><small>${esc(d.air)} · ${d.km} km</small></td>` + vals.map((v, w) => {
      const sel = w === s.week ? " selcol" : "";
      if (v == null) return `<td class="cell closed${sel}" tabindex="0" data-w="${w}" data-v="closed" title="${esc(d.name)} closes on ${esc(closeTxt(d))}">Closed</td>`;
      return `<td class="cell h${bucket(v)}${w === best ? " best" : ""}${sel}${late(SEASON, w) && d.spring === "poor" ? " thin" : ""}" tabindex="0" data-w="${w}" data-v="${v.toFixed(2)}" title="${esc(d.name)} via ${esc(d.air)}, ${esc(range(SEASON, s.pattern, w).text)}: ${euro(v)} per person">${euro(v)}</td>`;
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
function tierLine(s: State, h: HouseResult) {
  if (h.mode !== "tiers") return "";
  return `<div class="tierline"><span>Houses per person:</span>` + h.tiers.map((t) =>
    `<span class="${t.tier === s.house ? "on" : ""}">${TIER_LABEL[t.tier]} <b>${euro(t.medianPP)}</b></span>`).join("") + "</div>";
}

export function renderRank(s: State) {
  const w = s.week;
  $("rankTitle").textContent = "Ranking · " + range(SEASON, s.pattern, w).text;
  const closed = visible(s).filter((d) => shut(s, d, w));
  const rows = visible(s).filter((d) => !shut(s, d, w)).map((d) => ({ d, k: c(s, d, w) })).sort((a, b) => a.k.pp - b.k.pp);
  const max = Math.max(...rows.map((r) => r.k.pp), 1);
  const colors: Record<string, string> = { flight: "var(--c-flight)", ground: "var(--c-ground)", stay: "var(--c-stay)", pass: "var(--c-pass)", rent: "var(--c-rent)", food: "var(--c-food)", lesson: "var(--c-lesson)" };
  const labels: Record<string, string> = { flight: "Flight", ground: s.ground === "car" ? "Car" : "Transfer", stay: "House", pass: "Lift pass", rent: "Rental", food: "Food", lesson: "Lessons (group average)" };
  $("rank").innerHTML = rows.map(({ d, k }) => {
    const segs = (Object.keys(k.parts) as (keyof typeof k.parts)[]).map((p) =>
      `<span title="${labels[p]}: ${euro(k.parts[p])}" style="width:${((k.parts[p] / max) * 100).toFixed(2)}%;background:${colors[p]}"></span>`).join("");
    return `<div class="row"><div class="who"><b>${esc(d.name)}</b><small>via ${esc(d.air)} · ${d.km} km · ${esc(d.time.replace("~", ""))} · ${esc(d.alt)}</small><div class="tags">${pills(s, d, k, w)}</div>${tierLine(s, k.stay.houses)}</div>` +
      `<div class="bar" role="img" aria-label="${esc(d.name)} via ${esc(d.air)}: ${euro(k.pp)} per person">${segs}</div>` +
      `<div class="tot num"><b>${euro(k.pp)}</b><small>${euro(k.group)} group</small></div></div>`;
  }).join("") || `<p class="foot">No resort matches the filter.</p>`;
  if (closed.length) $("rank").insertAdjacentHTML("beforeend", `<p class="foot" style="padding-top:10px">Closed this week: ${closed.map((d) => `${esc(d.name)} via ${esc(d.air)} (closes ${esc(closeTxt(d))})`).join(", ")}.</p>`);
}

// ---- houses
const HOUSE_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 52h48M14 52V28l18-14 18 14v24M26 52V38h12v14" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M4 30 32 8l28 22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;
function sourceName(l: Listing) {
  const h = (() => { try { return new URL(l.url).hostname; } catch { return ""; } })();
  return /airbnb\./.test(h) ? "Airbnb" : /booking\./.test(h) ? "Booking.com" : /vrbo\./.test(h) ? "Vrbo" : h.replace(/^www\./, "") || "listing";
}
function card(s: State, x: Priced, label: string, sub: string, selected: boolean) {
  const l = x.l, src = sourceName(l);
  const qa = new Date(x.quote.checkin), qb = new Date(x.quote.checkout);
  const dates = qa.getUTCMonth() === qb.getUTCMonth() ? `${qa.getUTCDate()}–${fmt(qb)}` : `${fmt(qa)} – ${fmt(qb)}`;
  const nq = l.quotes.length;
  const photo = l.photo
    ? `<img src="${esc(l.photo)}" alt="${esc(l.title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span class="credit">Photo: ${esc(src)}</span>`
    : `<span class="ph">${HOUSE_SVG}</span>`;
  const facts = [`${l.bedrooms} bedroom${l.bedrooms > 1 ? "s" : ""}`, `sleeps ${l.sleeps}`];
  if (l.toLiftM != null) facts.push(l.toLiftM >= 1000 ? `${(l.toLiftM / 1000).toFixed(1)} km to lifts` : `${l.toLiftM} m to lifts`);
  if (l.rating != null) facts.push(`★ ${l.rating.toFixed(1)}/10`);
  return `<article class="hcard${selected ? " sel" : ""}">` +
    `<a class="hphoto" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">${photo}<span class="tier">${esc(label)}</span></a>` +
    `<div class="hbody"><span class="typ">${sub}</span><span class="ttl">${esc(l.title)}</span><small>${esc(facts.join(" · "))}</small>` +
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

export function renderHouses(s: State, repo: string) {
  const w = s.week, p = people(s.group), b = bedrooms(s.group);
  $("houseslede").textContent = `Houses with at least ${b} bedroom${b > 1 ? "s" : ""} that sleep ${p}, for ${range(SEASON, s.pattern, w).text}. ` +
    `They're split into the cheapest, middle and priciest third; each level shows its typical (median) price and the best-rated house nearest the lifts. ` +
    `The level you pick above sets the house cost everywhere else.`;
  const resorts = RESORTS_FILE.resorts.filter((r) => picked(s, r.id) && OPTIONS.some((d) => d.resort === r.id && (!s.limit || d.mins <= 125)));
  const withHouses: string[] = [], empty: Resort[] = [];
  for (const r of resorts) {
    const d = OPTIONS.find((o) => o.resort === r.id)!;
    const h = c(s, d, w).stay.houses;
    if (h.mode === "none") { empty.push(r); continue; }
    let cards: string, head: string;
    if (h.mode === "tiers") {
      cards = h.tiers.map((t) => card(s, t.pick, TIER_LABEL[t.tier],
        `Typical ${TIER_LABEL[t.tier].toLowerCase()}: <b>${euro(t.medianPP)}</b>/person · ${t.listings.length} house${t.listings.length > 1 ? "s" : ""}`, t.tier === s.house)).join("");
      head = `${h.eligible.length} houses fit your group`;
    } else {
      cards = h.eligible.map((x) => card(s, x, "Listed", "Only " + h.eligible.length + " fitting house" + (h.eligible.length > 1 ? "s" : "") + " so far", false)).join("");
      head = `Tiers need at least 3 fitting houses · find more: ${searchLinks(r, s)}`;
    }
    withHouses.push(`<div class="hres"><div class="hres-head"><b>${esc(r.name)}</b><span class="foot">${head}</span></div><div class="hcards">${cards}</div></div>`);
  }
  const add = `https://github.com/${repo}/blob/main/CONTRIBUTING.md#add-a-house`;
  const emptyHtml = empty.length ? `<div class="hres hempty"><span class="foot">No houses for ${b} bedroom${b > 1 ? "s" : ""} / ${p} people listed yet at these resorts, so their house price is an estimate. Found a good one? <a href="${esc(add)}" target="_blank" rel="noopener">Add it</a>.</span><ul>` +
    empty.map((r) => `<li><b style="color:var(--ink)">${esc(r.name)}</b>${(LISTINGS_BY_RESORT[r.id] || []).length ? ` (${LISTINGS_BY_RESORT[r.id].length} smaller listed)` : ""} · search ${searchLinks(r, s)}</li>`).join("") + "</ul></div>" : "";
  $("houses").innerHTML = withHouses.join("") + emptyHtml || `<p class="foot">No resort matches the filter.</p>`;
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
      `<td class="r num" data-v="${k.parts.food}">${euro(k.parts.food)}<br><small class="foot">${euro(+s.food || 0)} × ${SEASON.foodDays} days</small></td>` +
      `<td class="r">${inp("lesson")}<br><small class="foot">${euro(val(SEASON, s, d, "lesson", w) * s.days * (+s.beg || 0))} group</small></td>` +
      `<td class="r num total" data-v="${closed ? "closed" : k.pp}">${closed ? "Closed" : euro(k.pp)}</td><td class="r num" data-v="${closed ? "closed" : k.group}">${closed ? "–" : euro(k.group)}</td></tr>`;
  }).join("");
  applySort(s, "detail");
}

