// Shared trips: one organiser creates a trip from their pick, friends open the link, vote, add their own
// pick or post "I have a better option" (text, links, screenshots) for review. Stored in a Google Sheet
// through a small Apps Script web app (sheet/Code.gs); its URL comes from <meta name="snowfinder-api">.
import { GROUPS, decodeShare, encodeShare, groupId, type State } from "./state.ts";
import { RESORTS_FILE, SEASON } from "./data.ts";
import { addDays, foodDays, isoOf, nights } from "./model/calendar.ts";
import type { PatternKey } from "./types.ts";
import { combinations, esc, euro, hm, pickSummary, resetCache, type PickSummary } from "./ui/render.ts";
import { LISTINGS } from "./data.ts";
import { walkMins } from "./model/houses.ts";
import { loaderReady, loaderResult, loaderVariant, startLoader } from "./loader.ts";

const $ = (id: string) => document.getElementById(id)!;
const API = (document.querySelector('meta[name="snowfinder-api"]') as HTMLMetaElement | null)?.content || "";
export const tripsReady = () => /^https:\/\/|^http:\/\/localhost[:/]/.test(API); // localhost: a local stand-in for tests
export const tripId = () => new URLSearchParams(location.search).get("trip") || "";
/** The trip whose "challenge another group" link brought this visitor here, if any. */
const fromTrip = () => (new URLSearchParams(location.search).get("from") || "").replace(/[^\w]/g, "").slice(0, 20);

/** What a pick stores: enough to show its card and to reopen the exact plan. */
export interface PickData {
  listingId: string; title: string; url: string; photo: string | null; resort: string; airport: string;
  when: string; people: number; pp: number; group: number; houseTotal: number; walk: string;
  bedrooms: number; sleeps: number; share: string; foundBy?: string;
}
interface Pick { id: string; name: string; reason: string; created: string; data: PickData; status?: string; checked?: string; note?: string; approved?: string }
interface Idea { id: string; name: string; text: string; links: string[]; images: string[]; status: string; reply: string; created: string; checked?: string; approved?: string }
const isYes = (v?: string) => String(v || "").trim().toLowerCase() === "yes";
const isNo = (v?: string) => String(v || "").trim().toLowerCase() === "no";

/** "just now", "25 min ago", "3 h ago", else "4 Mar 10:30". */
function when(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso); if (isNaN(+d)) return "";
  const min = Math.round((Date.now() - +d) / 60000);
  if (min < 2) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}
/** The checker's verdict on a pick: is it still bookable for these dates at this price? */
function pickStatus(p: Pick, organizer: string) {
  if (isNo(p.approved)) return `<p class="pstat bad">Not approved by ${esc(organizer)}</p>`;
  if (!isYes(p.approved)) return `<p class="pstat">Waiting for ${esc(organizer)}'s OK before it's checked</p>`;
  const at = when(p.checked), note = p.note ? ` ${esc(p.note)}` : "";
  if (p.status === "available") return `<p class="pstat ok">✓ Still available${at ? ` · checked ${at}` : ""}${note ? ` ·${note}` : ""}</p>`;
  if (p.status === "unavailable") return `<p class="pstat bad">✕ No longer available for these dates${at ? ` · checked ${at}` : ""}.${note}</p>`;
  if (p.status === "changed") return `<p class="pstat warn">Price changed${at ? ` · checked ${at}` : ""}.${note}</p>`;
  return `<p class="pstat">Availability not checked yet</p>`;
}
interface TripView {
  trip: { id: string; organizer: string; title: string; parent?: string };
  picks: Pick[]; votes: { name: string; pick: string }[]; ideas: Idea[];
  limits?: { trips: number; people: number; tripsUsed: number; peopleUsed: number };
}

const NAME_KEY = "snowfinder-name";
/** A secret kept in this browser: the sheet locks a name to the browser that used it first. */
const BROWSER_KEY = (() => {
  const make = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
  try { let k = localStorage.getItem("snowfinder-key"); if (!k) { k = make(); localStorage.setItem("snowfinder-key", k); } return k; } catch { return make(); }
})();
/** Only https links are opened or shown as images (never javascript: or data:). */
const safeUrl = (u?: string | null) => (u && /^https:\/\//i.test(u) ? u : "");
const myName = () => { try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; } };
const setName = (n: string) => { try { localStorage.setItem(NAME_KEY, n); } catch { /* private mode */ } };

async function get(id: string): Promise<TripView> {
  const r = await fetch(`${API}?trip=${encodeURIComponent(id)}`);
  const j = await r.json();
  if (j.error) throw Object.assign(new Error(j.error), { trip: j.trip as string | undefined });
  return j;
}

// The trips this browser created, one per group setup (group id → trip id), so each group gets its own.
const TRIPS_KEY = "snowfinder-my-trips";
const myTrips = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(TRIPS_KEY) || "{}"); } catch { return {}; } };
const rememberTrip = (group: string, trip: string) => { try { localStorage.setItem(TRIPS_KEY, JSON.stringify({ ...myTrips(), [group]: trip })); } catch { /* private mode */ } };
// Every trip opened in this browser (trip id → its group, title and organiser), for "Trips by group".
const SEEN_KEY = "snowfinder-seen-trips";
type Seen = Record<string, { group: string; title: string; organizer: string; at: number }>;
const seenTrips = (): Seen => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}"); } catch { return {}; } };
function rememberSeen(id: string, group: string, title: string, organizer: string) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify({ ...seenTrips(), [id]: { group, title, organizer, at: Date.now() } })); } catch { /* private mode */ }
}
const groupLabel = (id: string) => GROUPS.find((g) => g.id === id)?.label || id;
/** The open trip's group setup, read from its title ("4 couples · Thu 4 Mar → Tue 9 Mar"). */
const tripGroup = () => GROUPS.find((g) => g.label === (last?.trip.title || "").split(" · ")[0])?.id || "";
/** The open trip's group and dates (from the organiser's pick), so a visitor's picks fit the trip. */
export function tripSettings(): Pick_<State, "group" | "pattern" | "week" | "days"> | null {
  if (!last) return null;
  const best = last.picks.find((p) => p.name === last!.trip.organizer) || last.picks[0];
  const s = best?.data.share ? decodeShare("#" + best.data.share, SEASON.weeks.length) : null;
  return s ? { group: s.group, pattern: s.pattern, week: s.week, days: s.days } : null;
}
type Pick_<T, K extends keyof T> = { [P in K]: T[P] };
function openTrip(id: string, s: State, toast: (m: string) => void) {
  history.pushState(null, "", `?trip=${encodeURIComponent(id)}`);
  last = null; confirmed = false;
  renderMyPick(s); loadTrip(s, toast);
  $("trip-block").classList.remove("collapsed");
  $("trip-block").scrollIntoView({ block: "start", behavior: "smooth" });
}
async function post(body: object): Promise<any> {
  // text/plain keeps this a "simple" request, so Apps Script needs no CORS preflight
  const r = await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ ...body, key: BROWSER_KEY }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}

export function pickData(s: State, p: PickSummary): PickData {
  const l = p.listing;
  return {
    listingId: l.id, title: l.title, url: l.url, photo: l.photo, resort: p.resort.name, airport: p.option.air,
    when: p.when, people: p.people, pp: Math.round(p.pp), group: Math.round(p.group), houseTotal: Math.round(p.houseTotal),
    walk: p.walk, bedrooms: l.bedrooms, sleeps: l.sleeps, share: encodeShare(s),
  };
}
export function autoReason(p: PickSummary): string {
  return `${p.resort.name}, ${p.walk}, ${p.listing.bedrooms} bedrooms for ${p.people}: ${euro(p.pp)} per person all in (flight via ${p.option.code}, house, pass, rental, food), ${p.when}.`;
}

/** The message the organiser sends to the group chat. *bold* is WhatsApp formatting. */
export function whatsappText(d: PickData, link: string): string {
  const s = d.share ? decodeShare("#" + d.share, SEASON.weeks.length) : null;
  const group = s ? GROUPS.find((g) => g.id === groupId(s.group))!.label : `${d.people} people`;
  // Prices are cached per render for the viewer's own settings: count with the pick's settings, then clear.
  const combos = s ? combinations(s) : 0;
  const n = s ? nights(SEASON, s.days) : 5;
  const country = RESORTS_FILE.resorts.find((r) => r.name === d.resort)?.country || "";
  return [
    `⛷️ *Ski trip – let's decide!*`,
    ``,
    combos > 1 ? `I compared *${combos.toLocaleString("en-GB")} combinations* of house, week, start day and flight across ${RESORTS_FILE.resorts.length} resorts for ${group.toLowerCase()}. The winner:` : `My pick for ${group.toLowerCase()}:`,
    `🏠 *${d.title}*${country ? ` (${d.resort}, ${country})` : ` (${d.resort})`}`,
    // First link in the message: WhatsApp turns it into a preview with the listing's photo.
    `📸 ${d.url}`,
    `📅 ${d.when} · ${n} nights`,
    `🚡 ${d.walk.charAt(0).toUpperCase()}${d.walk.slice(1)}`,
    `💶 *${euro(d.pp)} per person, all in*: flight from ${SEASON.origin.city}, house, lift pass, rental and food`,
    ``,
    `🏆 *Think you can beat it?* Find somewhere cheaper, closer to the lifts or nicer and send it on the trip page. If it really is better, it goes to the top with your name on it.`,
    ``,
    `👉 Vote, pick your own or take the challenge:`,
    link,
    ``,
    `⏳ Places go fast: let's decide soon.`,
  ].join("\n");
}

/** What makes up the price per person, one line each, adding up to the total. */
function priceBreakdown(s: State, p: PickSummary) {
  const r = p.parts, n = p.people, days = s.days, nts = nights(SEASON, s.days);
  const lines: [string, string, number][] = [
    ["✈", `Flight Porto → ${p.option.air}, return with a bag`, r.flight],
    [s.ground === "car" ? "🚗" : "🚐", s.ground === "car" ? `Rental car to the resort, shared (${Math.ceil(n / 5)} car${n > 5 ? "s" : ""} for ${n})` : `Transfer to the resort, shared by ${n}`, r.ground],
    ["🏠", `House, ${nts} nights: ${euro(p.houseTotal)} split by ${n}`, r.stay],
    ["🎫", `Lift pass, ${days} days`, r.pass],
    ["🎿", `Ski or snowboard rental, ${days} days`, r.rent],
    ["🍽", `Food, ${foodDays(SEASON, s.days)} days`, r.food],
  ];
  return `<details class="mp-why"><summary>What's in ${euro(p.pp)} per person</summary><ul>` +
    lines.filter(([, , v]) => v > 0).map(([i, t, v]) => `<li><span>${i} ${esc(t)}</span><b class="num">${euro(v)}</b></li>`).join("") +
    `<li class="mp-total"><span>All in, per person</span><b class="num">${euro(p.pp)}</b></li></ul>` +
    `<p class="foot">Prices for these dates, checked ${esc(SEASON.collected.slice(0, 10))}. Flights and houses move: check them before booking.</p></details>`;
}

// ---- the "Your pick" bar, shown once a house is chosen
export function renderMyPick(s: State) {
  const box = $("mypick"), p = pickSummary(s);
  if (!p) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  // In a trip of the same group you add your pick to it; for another group you start (or open) that group's trip.
  const g = groupId(s.group), inTrip = !!tripId() && (!last || tripGroup() === g || !tripGroup()), own = myTrips()[g];
  box.innerHTML = `<div class="mp-photo">${p.listing.photo ? `<img src="${esc(p.listing.photo)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : ""}</div>` +
    `<div class="mp-body"><span class="eyebrow"><span class="step">4</span>Your pick</span><b>${esc(p.listing.title)}</b>` +
    `<small>${esc(p.resort.name)} · ${esc(p.walk)} · ${esc(p.when)}</small>` +
    `<div class="mp-price"><b>${euro(p.pp)}</b><small>per person all in · ${euro(p.group)} group · house ${euro(p.housePP)} pp</small></div>` +
    `<label class="mp-air">✈ Flight <select id="mp-air">${p.flights.map((f) => {
      const t = SEASON.flightTimes[f.d.code];
      return `<option value="${esc(f.d.id)}"${f.d.id === p.option.id ? " selected" : ""}>${esc(f.d.air)}${t ? ` · ${hm(t.mins + f.d.mins)}` : ""} · ${euro(f.pp)} pp</option>`;
    }).join("")}</select></label></div>` +
    priceBreakdown(s, p) +
    `<div class="mp-acts">${tripsReady()
      ? inTrip ? `<button type="button" class="btn" data-act="add-pick">Add my pick to the trip</button>`
        : own ? `<button type="button" class="btn" data-act="open-trip" data-trip="${esc(own)}">Open our ${esc(groupLabel(g).toLowerCase())} trip</button>`
        : `<button type="button" class="btn" data-act="create-trip">Create a trip for ${esc(groupLabel(g).toLowerCase())}</button>`
      : `<span class="foot">Shared trips aren't set up on this site yet.</span>`}` +
    `<button type="button" class="ghost" data-act="clear-pick">Clear</button></div>`;
}

// ---- "Trips by group": one row per group setup, with the trips this browser created or opened
export function renderTripsByGroup(s: State) {
  const box = document.getElementById("tripsbygroup"); if (!box) return;
  const block = $("trips-block");
  block.hidden = !tripsReady(); if (block.hidden) return;
  const seen = seenTrips(), mine = myTrips(), here = tripId();
  for (const [g, id] of Object.entries(mine)) if (!seen[id]) seen[id] = { group: g, title: "", organizer: "", at: 0 };
  const cur = groupId(s.group);
  box.innerHTML = GROUPS.map((g) => {
    const trips = Object.entries(seen).filter(([, t]) => t.group === g.id).sort((a, b) => b[1].at - a[1].at);
    const list = trips.map(([id, t]) => {
      const when = t.title.split(" · ").slice(1).join(" · ");
      return `<li><button type="button" class="linkbtn" data-act="open-trip" data-trip="${esc(id)}">${esc(when || "Open the trip")}</button>` +
        `<span class="foot">${t.organizer ? ` by ${esc(t.organizer)}` : ""}${mine[g.id] === id ? " · yours" : ""}${id === here ? " · open now" : ""}</span></li>`;
    }).join("");
    return `<div class="tg-row${g.id === cur ? " on" : ""}"><div class="tg-top"><b>${esc(g.label)}</b>` +
      (trips.length ? "" : `<button type="button" class="btn secondary" data-act="start-group" data-g="${esc(g.id)}">Start one</button>`) + `</div>` +
      (list ? `<ul class="tg-list">${list}</ul>` : `<span class="foot">No trip yet.</span>`) + `</div>`;
  }).join("") + `<p class="foot">Trips you created or opened on this phone. One trip per group: “Start one” sets the group, then choose a house and “Create a trip”.</p>`;
}

// ---- the dialog that asks for a name (and a reason when making a pick)
function ask(title: string, withReason: string | null): Promise<{ name: string; reason: string } | null> {
  const d = $("askdlg") as HTMLDialogElement;
  $("ask-title").textContent = title;
  ($("ask-name") as HTMLInputElement).value = myName();
  const reason = $("ask-reason") as HTMLTextAreaElement;
  reason.parentElement!.hidden = withReason == null; reason.value = withReason || "";
  d.showModal();
  return new Promise((res) => {
    d.onclose = () => {
      const name = ($("ask-name") as HTMLInputElement).value.trim();
      if (d.returnValue !== "ok" || !name) return res(null);
      setName(name); res({ name, reason: reason.value.trim() });
    };
  });
}

export async function createTrip(s: State, toast: (m: string) => void) {
  const p = pickSummary(s); if (!p) return;
  const a = await ask("Create our trip", autoReason(p)); if (!a) return;
  try {
    const { trip } = await post({ action: "createTrip", name: a.name, title: `${groupLabel(groupId(s.group))} · ${p.when}`, reason: a.reason, data: pickData(s, p), parent: fromTrip() });
    rememberTrip(groupId(s.group), trip);
    history.pushState(null, "", `?trip=${trip}`);
    last = null;
    await loadTrip(s, toast);
    renderMyPick(s);
    confirmed = true;
    renderTrip(s);
    toast("Trip created. Copy the message below and paste it in your group chats.");
    document.getElementById("tmsg-text")?.scrollIntoView({ block: "center", behavior: "smooth" });
  } catch (e) {
    const old = (e as { trip?: string }).trip;
    if (old) { rememberTrip(groupId(s.group), old); toast(`${(e as Error).message} Opening it.`); openTrip(old, s, toast); return; }
    toast(`Couldn't create the trip: ${(e as Error).message}`);
  }
}
export async function addPick(s: State, toast: (m: string) => void) {
  const p = pickSummary(s); if (!p) return;
  const a = await ask("Add my pick", autoReason(p)); if (!a) return;
  try {
    await post({ action: "addPick", trip: tripId(), name: a.name, reason: a.reason, data: pickData(s, p) });
    confirmed = true;
    toast(`Your pick is in, with your vote. ${last?.trip.organizer || "The organiser"} approves it before it's checked.`);
    await loadTrip(s, toast);
    document.getElementById("challenge")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  catch (e) { toast(`Couldn't add your pick: ${(e as Error).message}`); }
}
async function vote(pick: string, s: State, toast: (m: string) => void) {
  let name = myName();
  if (!name) { const a = await ask("Your name, to vote", null); if (!a) return; name = a.name; }
  try { await post({ action: "vote", trip: tripId(), name, pick }); await loadTrip(s, toast); }
  catch (e) { toast(`Couldn't vote: ${(e as Error).message}`); }
}

// ---- the trip panel at the top
let last: TripView | null = null;
/** Set once this visitor confirms a selection (creates the trip or adds a pick): then the challenge prompt shows. */
let confirmed = false;

/** Invite another group of friends to plan their own snow trip; their trip remembers who challenged them. */
function challengeHtml(trip: TripView["trip"]) {
  const link = `${location.origin}${location.pathname}?from=${encodeURIComponent(trip.id)}`;
  const text = `⛷️ We're planning our ski trip on Snowfinder: every resort, week and house priced per person, all in. ` +
    `Any group of friends up for a snow trip? Plan yours here: ${link}`;
  return `<div class="tchallenge" id="challenge"><b>🎿 Any other group of friends you want to challenge to a snow trip?</b>` +
    `<span class="foot">Send them Snowfinder: they plan their own trip, their own way.</span>` +
    `<div class="tmsg-acts"><a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Challenge a group on WhatsApp</a>` +
    `<button type="button" class="btn secondary" data-act="copy-challenge" data-text="${esc(text)}">Copy the invite</button></div></div>`;
}
let stopLoader: (() => void) | null = null;
export async function loadTrip(s: State, toast: (m: string) => void) {
  const id = tripId(), box = $("trip-block");
  if (!id) { box.hidden = true; return; }
  box.hidden = false;
  if (!tripsReady()) { $("trip-body").innerHTML = `<p class="foot">This trip link needs the shared-trip sheet, which isn't set up on this copy of the site.</p>`; return; }
  // First load: a small widget keeps the visitor busy while the sheet answers (see loader.ts).
  // It stays above the trip once loaded, still playing, and the page glides down to the trip.
  const first = !last;
  if (first) { stopLoader?.(); $("trip-body").innerHTML = ""; stopLoader = startLoader($("trip-loader"), loaderVariant()); }
  try {
    const t = await get(id); last = t; renderTrip(s); renderMyPick(s);
    if (first) {
      const best = t.picks.find((p) => p.name === t.trip.organizer) || t.picks[0], vb = best ? verified(best.data) : null;
      const pp = vb?.known ? vb.pp : best?.data.pp ?? null;
      $("trip-body").insertAdjacentHTML("afterbegin", loaderResult(pp));
      loaderReady($("trip-loader"), pp, $("trip-body"));
    }
  }
  catch (e) { stopLoader?.(); $("trip-loader").innerHTML = ""; $("trip-body").innerHTML = `<p class="foot">Couldn't load this trip: ${esc((e as Error).message)}.</p>`; }
}

/** Prices on a pick card come from the site's own data (the house and the pick's settings), never from what
 *  was posted, so nobody can show a fake "€1 per person". A house the site doesn't know isn't priced. */
function verified(d: PickData): { pp: number; group: number; known: boolean } {
  const s = d.share ? decodeShare("#" + d.share, SEASON.weeks.length) : null;
  if (!s || !LISTINGS.some((l) => l.id === d.listingId)) return { pp: 0, group: 0, known: false };
  resetCache(); const p = pickSummary({ ...s, pick: d.listingId }); resetCache();
  return p ? { pp: p.pp, group: p.group, known: true } : { pp: 0, group: 0, known: false };
}

// ---- votes: everyone sees the count for each pick; from 2 votes on, pros and cons for each, worked out
// by fixed rules from the site's own data (price, walk to the lifts, rating, travel time), never from text
// people typed.
interface Facts { pp: number; known: boolean; walkM: number | null; rating: number | null; travel: number | null }
function facts(d: PickData): Facts {
  const s = d.share ? decodeShare("#" + d.share, SEASON.weeks.length) : null;
  const l = LISTINGS.find((x) => x.id === d.listingId);
  let p: PickSummary | null = null;
  if (s && l) { resetCache(); p = pickSummary({ ...s, pick: d.listingId }); resetCache(); }
  const t = p ? SEASON.flightTimes[p.option.code] : undefined;
  return { pp: p ? p.pp : 0, known: !!p, walkM: l?.toLiftM ?? null, rating: l?.rating ?? null, travel: p && t ? t.mins + p.option.mins : null };
}
function prosCons(xs: { p: Pick; f: Facts }[]) {
  const known = xs.filter((x) => x.f.known), low = Math.min(...known.map((x) => x.f.pp));
  const times = xs.map((x) => x.f.travel).filter((t): t is number => t != null), fast = Math.min(...times), slow = Math.max(...times);
  return new Map(xs.map(({ p, f }) => {
    const pros: string[] = [], cons: string[] = [];
    if (!f.known) cons.push("Price not verified: not one of the site's houses");
    else if (f.pp - low < 20) pros.push(known.length > 1 && f.pp === low ? `Cheapest: ${euro(f.pp)} per person all in` : `${euro(f.pp)} per person all in`);
    else cons.push(`${euro(f.pp - low)} more per person than the cheapest (${euro(f.pp)} all in)`);
    if (f.walkM == null) cons.push("Distance to the lifts not stated");
    else if (f.walkM <= 100) pros.push("Ski in / ski out");
    else if (walkMins(f.walkM) <= 10) pros.push(`${walkMins(f.walkM)} min walk to the lifts`);
    else cons.push(`${walkMins(f.walkM)} min walk to the lifts: shuttle or car`);
    if (f.rating != null && f.rating >= 9) pros.push(`Guests rate it ${f.rating.toFixed(1)}/10`);
    else if (f.rating != null && f.rating < 8) cons.push(`Guests rate it only ${f.rating.toFixed(1)}/10`);
    if (f.travel != null && slow - fast >= 30) {
      if (f.travel === fast) pros.push(`Quickest to get there: ${hm(f.travel)} door to door`);
      else if (f.travel - fast >= 30) cons.push(`${f.travel - fast < 60 ? `${f.travel - fast} min` : hm(f.travel - fast)} longer to get there (${hm(f.travel)} door to door)`);
    }
    return [p.id, { pros, cons }];
  }));
}
const MEDALS = ["🥇", "🥈", "🥉"];
function votesHtml(trip: TripView["trip"], picks: Pick[], byPick: (id: string) => string[]) {
  if (!picks.length) return "";
  const xs = picks.map((p) => ({ p, f: facts(p.data), v: byPick(p.id) })).sort((a, b) => b.v.length - a.v.length);
  const total = xs.reduce((n, x) => n + x.v.length, 0), most = Math.max(1, ...xs.map((x) => x.v.length));
  const pc = total > 1 ? prosCons(xs) : null;
  const rows = xs.map((x, i) => {
    const c = pc?.get(x.p.id);
    return `<div class="tv-row"><div class="tv-top"><b>${x.v.length ? (MEDALS[i] || "•") + " " : ""}${esc(x.p.data.title)}</b><span class="num">${x.v.length} vote${x.v.length === 1 ? "" : "s"}</span></div>` +
      `<div class="tv-bar" aria-hidden="true"><span style="width:${((x.v.length / most) * 100).toFixed(0)}%"></span></div>` +
      `<small>${esc(x.p.data.resort)} · ${esc(x.p.data.when)}${x.v.length ? ` · ${x.v.map(esc).join(", ")}` : ""}</small>` +
      (c ? `<ul class="tv-pc">${c.pros.map((t) => `<li class="pro">✅ ${esc(t)}</li>`).join("")}${c.cons.map((t) => `<li class="con">⚠️ ${esc(t)}</li>`).join("")}</ul>` : "") + `</div>`;
  }).join("");
  const link = `${location.origin}${location.pathname}?trip=${encodeURIComponent(trip.id)}`;
  const msg = pc ? [
    `🗳️ *Ski trip vote: where we stand*`, trip.title ? `_${trip.title}_` : "", ``,
    ...xs.flatMap((x, i) => {
      const c = pc.get(x.p.id)!;
      return [`${x.v.length ? MEDALS[i] || "•" : "•"} *${x.p.data.title}* (${x.p.data.resort}) · ${x.v.length} vote${x.v.length === 1 ? "" : "s"}${x.v.length ? `: ${x.v.join(", ")}` : ""}`,
        ...c.pros.map((t) => `✅ ${t}`), ...c.cons.map((t) => `⚠️ ${t}`), ``];
    }),
    `👉 Not voted yet? Vote here:`, link,
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n") : "";
  return `<div class="tvotes" id="votes"><h3 class="tsub">🗳️ Votes <span class="foot">${total} so far</span></h3>${rows}` +
    (pc ? `<div class="tmsg"><label for="tvotes-text">Vote update for your group chats</label><textarea id="tvotes-text" readonly rows="8">${esc(msg)}</textarea>` +
      `<div class="tmsg-acts"><button type="button" class="btn" data-act="copy-votes">Copy vote update</button>` +
      `<a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Send on WhatsApp</a></div></div>`
      : `<p class="foot">Pros and cons of each pick show up from 2 votes.</p>`) + `</div>`;
}

function pickCard(p: Pick, votes: string[], mine: string, flag: string) {
  const d = p.data, v = verified(d);
  return `<article class="tpick${flag ? " pinned" : ""}">` +
    (flag ? `<div class="tflag">${flag}</div>` : "") +
    `<div class="tp-main"><a class="tp-photo" href="${esc(safeUrl(d.url) || "#")}" target="_blank" rel="noopener noreferrer">${safeUrl(d.photo) ? `<img src="${esc(safeUrl(d.photo))}" alt="" referrerpolicy="no-referrer" loading="lazy">` : ""}</a>` +
    `<div class="tp-body"><b>${esc(d.title)}</b><small>${esc(d.resort)} · ${esc(d.walk)} · ${d.bedrooms} bedrooms, sleeps ${d.sleeps}</small>` +
    `<small>${esc(d.when)} · flying to ${esc(d.airport)}</small>` +
    (v.known ? `<div class="mp-price"><b>${euro(v.pp)}</b><small>per person all in · ${euro(v.group)} for ${d.people}</small></div>`
      : `<p class="pstat warn">Not one of the site's houses: price not verified</p>`) + `</div></div>` +
    pickStatus(p, last?.trip.organizer || "the organiser") +
    (p.reason ? `<p class="tp-why">“${esc(p.reason)}” <span class="foot">— ${esc(p.name)}</span></p>` : `<p class="foot">Picked by ${esc(p.name)}</p>`) +
    `<div class="tp-acts"><button type="button" class="btn${mine === p.id ? "" : " secondary"}" data-vote="${esc(p.id)}" aria-pressed="${mine === p.id}">${mine === p.id ? "✓ Your vote" : "Vote for this"}</button>` +
    `<span class="tp-votes"><b>${votes.length}</b> vote${votes.length === 1 ? "" : "s"}${votes.length ? `: ${votes.map(esc).join(", ")}` : ""}</span>` +
    `<a class="tp-open" href="?trip=${esc(tripId())}#${esc(d.share)}">Open this plan</a>` +
    (safeUrl(d.url) ? `<a class="tp-open" href="${esc(safeUrl(d.url))}" target="_blank" rel="noopener noreferrer">View listing ↗</a>` : "") + `</div></article>`;
}

function renderTrip(_s: State) {
  if (!last) return;
  const { trip, picks, votes, ideas } = last;
  const me = myName().toLowerCase();
  const byPick = (id: string) => votes.filter((v) => v.pick === id).map((v) => v.name);
  const mine = votes.find((v) => v.name.toLowerCase() === me)?.pick || "";
  const best = picks.find((p) => p.name === trip.organizer) || picks[0];
  // What the organiser hasn't approved stays out of sight: everyone sees how many are waiting, only the
  // organiser and the person who sent it see the details. Spam and odd text never reach the group.
  const norm = (s: string) => s.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  const isOrg = !!me && norm(me) === norm(trip.organizer);
  // Trips made before this browser kept a list: the organiser's own trip is remembered when they open it.
  if (isOrg && tripGroup() && !myTrips()[tripGroup()]) rememberTrip(tripGroup(), trip.id);
  rememberSeen(trip.id, tripGroup(), trip.title, trip.organizer);
  renderTripsByGroup(_s);
  const shown = (x: { name: string; approved?: string }) => isYes(x.approved) || isOrg || (!!me && norm(x.name) === norm(me));
  const hiddenPicks = picks.filter((p) => p !== best && !shown(p));
  const found = picks.filter((p) => p !== best && p.data.foundBy && shown(p));
  const rest = picks.filter((p) => p !== best && !p.data.foundBy && shown(p)).sort((a, b) => byPick(b.id).length - byPick(a.id).length);
  const waitingNote = (n: number, what: string) => n ? `<p class="foot">${n} ${what}${n > 1 ? "s" : ""} waiting for ${esc(trip.organizer)}'s OK.</p>` : "";
  const leader = [...picks].sort((a, b) => byPick(b.id).length - byPick(a.id).length)[0];
  $("trip-title").innerHTML = `<span class="step">5</span>${esc(trip.title ? `Our trip · ${trip.title}` : "Our trip")}`;
  // Keep the pressure visible: how many picks are still bookable, and loudly when the best one is gone.
  const checked = picks.filter((p) => p.status && p.status !== "unchecked");
  const free = checked.filter((p) => p.status !== "unavailable").length;
  const lastIso = checked.map((p) => p.checked || "").sort().pop();
  const alert = best?.status === "unavailable"
    ? `<div class="talert" role="alert">⚠ <b>${esc(trip.organizer)}'s pick is no longer available</b> for these dates. Vote for another pick below or choose a new one: places are going.</div>`
    : picks.some((p) => p.status === "unavailable") ? `<div class="talert warn" role="status">${picks.filter((p) => p.status === "unavailable").length} pick${picks.filter((p) => p.status === "unavailable").length > 1 ? "s are" : " is"} no longer available. Decide soon.</div>` : "";
  const pulse = `<p class="tpulse"><span class="dot" aria-hidden="true"></span>Availability checked by ${esc(trip.organizer)}` +
    (checked.length ? ` · <b>${free} of ${checked.length}</b> pick${checked.length > 1 ? "s" : ""} still free · last check ${when(lastIso)}` : " · not checked yet") + `</p>`;
  // Free WhatsApp share: opens WhatsApp with the message ready; the sender picks the chat or group.
  const link = `${location.origin}${location.pathname}?trip=${encodeURIComponent(trip.id)}`;
  const bv = best ? verified(best.data) : null;
  const msg = best ? whatsappText(bv?.known ? { ...best.data, pp: Math.round(bv.pp) } : best.data, link) : `⛷️ Our ski trip: vote here ${link}`;
  const wa = `<a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Send on WhatsApp</a>`;
  const box = `<div class="tmsg"><label for="tmsg-text">Message for your group chats</label>` +
    `<textarea id="tmsg-text" readonly rows="12">${esc(msg)}</textarea>` +
    `<div class="tmsg-acts"><button type="button" class="btn" data-act="copy-msg">Copy message</button>${wa}` +
    `<span class="foot">Paste it in each group. The house link shows its photo in WhatsApp.</span></div></div>`;
  const lim = last.limits;
  const others = Object.entries(myTrips()).filter(([, id]) => id !== trip.id);
  const limits = (lim ? `<p class="foot">${lim.peopleUsed} of ${lim.people} people on this trip · ${lim.tripsUsed} of ${lim.trips} trips</p>` : "") +
    (others.length ? `<p class="foot">Your other trips: ${others.map(([g, id]) => `<button type="button" class="linkbtn" data-act="open-trip" data-trip="${esc(id)}">${esc(groupLabel(g))}</button>`).join(" · ")}</p>` : "") +
    `<p class="foot">Another group? Pick it in Filters, choose a house and “Create a trip” for it: one trip per group.</p>`;
  const visible = [best, ...found, ...rest].filter((p): p is Pick => !!p);
  $("trip-body").innerHTML = alert + pulse + box + (confirmed ? challengeHtml(trip) : "") + limits + votesHtml(trip, visible, byPick) +
    (best ? pickCard(best, byPick(best.id), mine, `<b>${esc(trip.organizer)}</b> looked into this — best pick for the group`) : "") +
    found.map((p) => pickCard(p, byPick(p.id), mine, `★ Found by <b>${esc(p.data.foundBy!)}</b>`)).join("") +
    (leader && byPick(leader.id).length && leader !== best ? `<p class="foot">Most votes so far: <b>${esc(leader.data.title)}</b>.</p>` : "") +
    (rest.length || hiddenPicks.length ? `<h3 class="tsub">Everyone's picks</h3>` + rest.map((p) => pickCard(p, byPick(p.id), mine, "")).join("") + waitingNote(hiddenPicks.length, "pick") : "") +
    `<h3 class="tsub">Pick your own</h3><p class="foot">Open steps 1–3 above: pick a week, “Choose this house”, a flight, then “Add my pick to the trip”.</p>` +
    ideasHtml(ideas.filter(shown)) + waitingNote(ideas.filter((x) => !shown(x)).length, "suggested place");
}

function ideasHtml(ideas: Idea[]) {
  const org = last?.trip.organizer || "the organiser";
  const label = (x: Idea) => x.status === "approved" ? `<span class="pill p-ok">Approved</span>`
    : x.status === "not approved" || isNo(x.approved) ? `<span class="pill p-bad">Not approved</span>`
    : !isYes(x.approved) ? `<span class="pill p-neutral">Waiting for ${esc(org)}'s OK</span>`
    : `<span class="pill p-neutral">${esc(org)} is checking it</span>`;
  const list = ideas.map((x) => `<article class="tidea"><b>${esc(x.name)}</b> ${label(x)}${x.checked ? ` <span class="foot">checked ${when(x.checked)}</span>` : ""}` +
    `<p>${esc(x.text)}</p>` +
    (x.links.filter((l) => safeUrl(l)).length ? `<p>${x.links.filter((l) => safeUrl(l)).map((l) => `<a href="${esc(l)}" target="_blank" rel="noopener noreferrer">${esc(l.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48))}↗</a>`).join(" ")}</p>` : "") +
    (x.images.filter((u) => safeUrl(u)).length ? `<div class="tidea-imgs">${x.images.filter((u) => safeUrl(u)).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer"><img src="${esc(u)}" alt="Screenshot from ${esc(x.name)}" loading="lazy" referrerpolicy="no-referrer"></a>`).join("")}</div>` : "") +
    (x.reply ? `<div class="treply"><span class="eyebrow">${x.status === "not approved" ? "Why not" : "Review"}</span><p>${esc(x.reply)}</p></div>` : "") + `</article>`).join("");
  return `<h3 class="tsub">I have a better option</h3>` +
    `<form id="ideaform" class="ideaform"><p class="foot">Found something better that isn't here? Paste its Airbnb or Booking.com link (needed), say why it's better and add screenshots. ${esc(org)} checks every suggestion himself: does it exist, is it free for these dates, at that price? If it beats the picks above it's pinned with your name; otherwise you get a reply saying why. Up to 3 per person.</p>` +
    `<label>Your name<input name="name" required maxlength="40" value="${esc(myName())}"></label>` +
    `<label>What's better about it?<textarea name="text" required maxlength="4000" rows="3" placeholder="e.g. 5 bedrooms right on the piste in Soldeu, €3,200 for the week"></textarea></label>` +
    `<label>Airbnb or Booking.com link (one per line)<textarea name="links" rows="2" required placeholder="https://www.airbnb.com/rooms/…"></textarea></label>` +
    `<label>Screenshots (up to 3)<input name="images" type="file" accept="image/*" multiple></label>` +
    `<button type="submit" class="btn">Send for review</button></form>` + (list ? `<div class="tideas">${list}</div>` : "");
}

/** Phone screenshots are big: shrink to 1600 px JPEG before sending. */
async function shrink(f: File): Promise<{ name: string; type: string; b64: string } | null> {
  try {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext("2d")!.drawImage(bmp, 0, 0, cv.width, cv.height);
    const url = cv.toDataURL("image/jpeg", 0.82);
    return { name: f.name.replace(/\.\w+$/, ".jpg"), type: "image/jpeg", b64: url.split(",")[1] };
  } catch { return null; }
}

export function wireTrip(getState: () => State, update: (m: (s: State) => void) => void, toast: (m: string) => void) {
  document.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const choose = t.closest<HTMLElement>(".choose");
    if (choose) {
      const { pick: id, week, checkin, nights } = choose.dataset;
      update((s) => {
        s.pick = s.pick === id ? undefined : id; s.air = undefined;
        if (!s.pick) return;
        if (week != null) s.week = +week;
        // A real quote for these dates: the dates bar follows it (start day, 4 or 5 ski days).
        if (!checkin || !nights || (+nights !== 5 && +nights !== 6)) return;
        for (const pat of Object.keys(SEASON.patterns) as PatternKey[]) {
          const w = SEASON.weeks.findIndex((sat) => isoOf(addDays(sat, SEASON.patterns[pat].from)) === checkin);
          if (w >= 0) { s.pattern = pat; s.days = (+nights - 1) as 4 | 5; s.week = w; }
        }
      });
      return;
    }
    const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "create-trip") createTrip(getState(), toast);
    else if (act === "add-pick") addPick(getState(), toast);
    else if (act === "start-group") {
      const g = GROUPS.find((x) => x.id === t.closest<HTMLElement>("[data-g]")!.dataset.g);
      if (g) {
        update((s) => { s.group = { ...g.group }; s.pick = undefined; s.air = undefined; });
        document.getElementById("houses-block")?.scrollIntoView({ block: "start", behavior: "smooth" });
        toast(`Group set to ${g.label.toLowerCase()}. Choose a house, then “Create a trip”.`);
      }
    }
    else if (act === "open-trip") openTrip(t.closest<HTMLElement>("[data-trip]")!.dataset.trip!, getState(), toast);
    else if (act === "clear-pick") update((s) => { s.pick = undefined; s.air = undefined; });
    else if (act === "copy-challenge") {
      const text = t.closest<HTMLElement>("[data-text]")!.dataset.text!;
      navigator.clipboard.writeText(text).then(() => toast("Invite copied: paste it to the other group."), () => window.prompt("Copy this invite:", text));
    }
    else if (act === "copy-votes") {
      const ta = $("tvotes-text") as HTMLTextAreaElement;
      navigator.clipboard.writeText(ta.value).then(() => toast("Vote update copied: paste it in the group chat."), () => { ta.select(); toast("Selected: copy it with your phone's Copy."); });
    }
    else if (act === "copy-msg") {
      const ta = $("tmsg-text") as HTMLTextAreaElement;
      navigator.clipboard.writeText(ta.value).then(() => toast("Message copied: paste it in each group chat."), () => { ta.select(); toast("Selected: copy it with your phone's Copy."); });
    }
    const v = t.closest<HTMLElement>("[data-vote]");
    if (v) vote(v.dataset.vote!, getState(), toast);
  });
  document.addEventListener("change", (ev) => {
    const t = ev.target as HTMLSelectElement;
    if (t.id === "mp-air") update((s) => { s.air = t.value; });
  });
  document.addEventListener("submit", async (ev) => {
    const form = ev.target as HTMLFormElement; if (form.id !== "ideaform") return;
    ev.preventDefault();
    const fd = new FormData(form), name = String(fd.get("name") || "").trim();
    const files = ((form.elements.namedItem("images") as HTMLInputElement).files || []) as FileList;
    const btn = form.querySelector("button")!; btn.disabled = true; btn.textContent = "Sending…";
    try {
      const images = (await Promise.all([...files].slice(0, 3).map(shrink))).filter(Boolean);
      const links = String(fd.get("links") || "").split(/\s+/).filter((l) => /^https?:\/\//.test(l));
      setName(name);
      await post({ action: "idea", trip: tripId(), name, text: String(fd.get("text") || ""), links, images });
      toast("Sent. You'll see the review here.");
      await loadTrip(getState(), toast);
    } catch (e) { toast(`Couldn't send it: ${(e as Error).message}`); btn.disabled = false; btn.textContent = "Send for review"; }
  });
}
