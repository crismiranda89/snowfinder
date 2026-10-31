// Shared trips: one organiser creates a trip from their pick, friends open the link, vote, add their own
// pick or post "I have a better option" (text, links, screenshots) for review. Stored in a Google Sheet
// through a small Apps Script web app (sheet/Code.gs); its URL comes from <meta name="snowfinder-api">.
import { GROUPS, decodeShare, encodeShare, groupFromId, groupId, groupLabel, normGroup, type State } from "./state.ts";
import type { Group } from "./types.ts";
import { renderDeck } from "./ui/deck.ts";
import { RESORTS_FILE, SEASON } from "./data.ts";
import { addDays, foodDays, isoOf, nights, range as seasonRange } from "./model/calendar.ts";
import type { PatternKey } from "./types.ts";
import { breakdownList, combinations, esc, euro, hm, pickSummary, resetCache, type PickSummary } from "./ui/render.ts";
import { LISTINGS } from "./data.ts";
import { walkMins } from "./model/houses.ts";
import { glide, loaderResult, loaderVariant, startLoader, type LoaderHandle } from "./loader.ts";
import { haptic } from "./ui/haptic.ts";
import { openPromo } from "./ui/promo.ts";

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
interface TripView {
  trip: { id: string; organizer: string; title: string; parent?: string };
  picks: Pick[]; votes: { name: string; pick: string }[]; ideas: Idea[];
  limits?: { trips: number; people: number; tripsUsed: number; peopleUsed: number };
  /** The organiser's own loading-game answers and guess, shown on the shared card under their name. */
  organizerQuiz?: { answers: string[]; guess: number | null } | null;
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
/** The open trip's group setup, read from its title ("4 couples · Thu 4 Mar → Tue 9 Mar"). */
const tripGroup = () => {
  const label = (last?.trip.title || "").split(" · ")[0], named = GROUPS.find((g) => g.label === label);
  if (named) return named.id;
  const sp = sharedPlan(); return sp ? groupId(sp.s.group) : "";
};
/** The open trip's group and dates (from the organiser's pick), so a visitor's picks fit the trip. */
/** The organiser's pick on the open trip and its full plan (dates, group, house, flight, food, filters). */
// Older trip links carry a snapshot of the organiser's pick after "#t=" (organiser, the pick's plan, their quiz), so
// a friend's phone draws the card at once; they still work. Links shared now are short (see tripLink).
interface Snapshot { o: string; s: string; q?: { answers: string[]; guess: number | null } | null }
const unb64 = (x: string) => new TextDecoder().decode(Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
function snapshot(): Snapshot | null {
  const m = /[#&]t=([\w-]+)/.exec(location.hash); if (!m) return null;
  try { const v = JSON.parse(unb64(m[1])); return typeof v?.o === "string" && typeof v?.s === "string" ? v : null; } catch { return null; }
}
/** The link to a trip, short enough for a chat: just its id. A first visit shows the loading card for the few
 *  seconds the sheet takes; after that the phone keeps a copy and it opens at once. */
function tripLink(t: TripView) {
  return `${location.origin}${location.pathname}?trip=${encodeURIComponent(t.trip.id)}`;
}
/** The organiser's pick on the open trip and its full plan (dates, group, house, flight, food, filters): from the
 *  loaded trip, or from the link's snapshot while the sheet hasn't answered yet. */
function sharedPlan(t = last): { organizer: string; listingId: string; s: State } | null {
  let organizer = "", share = "";
  if (t) {
    const best = t.picks.find((p) => p.name === t.trip.organizer) || t.picks[0];
    organizer = t.trip.organizer; share = best?.data.share || "";
  } else { const sn = snapshot(); if (sn) { organizer = sn.o; share = sn.s; } }
  const s = share ? decodeShare("#" + share, SEASON.weeks.length) : null;
  return s?.pick ? { organizer, listingId: s.pick, s } : null;
}
/** The organiser's quiz: from the loaded trip, else from the link's snapshot. */
const organizerQuiz = () => (last ? last.organizerQuiz : snapshot()?.q) || null;
/** The shared plan's settings, for the visitor's own plan (their sort order stays theirs). */
export function tripSettings(): Omit<State, "sort"> | null {
  const sp = sharedPlan(); if (!sp) return null;
  const { sort: _sort, ...rest } = sp.s;
  return rest;
}
/** Whether this browser has opened the trip before (a first visit takes on the shared plan). */
export const tripSeen = (id: string) => !!seenTrips()[id];
function openTrip(id: string, s: State, toast: (m: string) => void) {
  history.pushState(null, "", `?trip=${encodeURIComponent(id)}`);
  last = null;
  loader?.stop(); loader = null;
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
  const group = s ? groupLabel(groupId(s.group)) : `${d.people} people`;
  // Prices are cached per render for the viewer's own settings: count with the pick's settings, then clear.
  const combos = s ? combinations(s) : 0;
  const n = s ? nights(SEASON, s.days) : 5;
  const country = RESORTS_FILE.resorts.find((r) => r.name === d.resort)?.country || "";
  return [
    `*Let's plan a snow trip together?* ❄️⛷️🏂`,
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
  return `<details class="mp-why"><summary>What's in ${euro(p.pp)} per person</summary>${breakdownList(s, p)}</details>`;
}

// ---- the welcome card on a shared trip link: the organiser's pick, laid out like "Your pick", with the
// exact flight of the shared plan. While the trip loads (and on a first visit until the games are done) the
// loading games play inside it instead, so the price isn't given away before the guess.
let welcomeHtml = "";
// While the suggested trip loads: a card shaped like the pick (photo, name, price) shimmering, with snow falling.
const WELCOME_LOADING = `<div class="mypick welcomecard wc-loading" role="status" aria-label="Loading the suggested trip">` +
  `<div class="mp-photo wc-sk"><span class="wc-flakes" aria-hidden="true">${"<i>❄</i>".repeat(6)}</span></div>` +
  `<div class="mp-body"><span class="eyebrow">🎿 Loading the suggested trip…</span><span class="wc-sk wc-line"></span><span class="wc-sk wc-line short"></span><span class="wc-sk wc-price"></span></div></div>`;
let explored = false; // set by Explore (or creating a trip): the card stays closed for the rest of the visit
function renderWelcome(result = "") {
  const box = $("welcome"), sp = sharedPlan(); if (!sp) return;
  if (explored) { box.hidden = true; return; }
  const { s } = sp;
  resetCache(); const p = pickSummary(s); resetCache();
  if (!p) { box.innerHTML = welcomeHtml = ""; box.hidden = true; return; }
  const org = sp.organizer, who = /^AI pick/i.test(org) ? `🤖 ${esc(org)}` : `👋 ${esc(org.split(/\s+/)[0])} picked this`;
  const t = SEASON.flightTimes[p.option.code], rg = seasonRange(SEASON, s.pattern, s.week, s.days), o = SEASON.origin;
  const ci = isoOf(rg.a), co = isoOf(rg.b);
  const gf = `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${o.code} to ${p.option.code} on ${ci} returning ${co}`)}`;
  // Lock it = a vote for the organiser's pick. Until the trip loads its id isn't known; the button shows anyway.
  const best = last && (last.picks.find((p) => p.name === last!.trip.organizer) || last.picks[0]);
  const me = myName().toLowerCase(), locked = !!best && !!me && last!.votes.some((v) => v.pick === best.id && v.name.toLowerCase() === me);
  const lock = locked ? `<button type="button" class="btn wc-lock" aria-pressed="true" disabled>✓ Locked in</button>`
    : `<button type="button" class="btn wc-lock" data-act="lock-it"${best ? ` data-pick="${esc(best.id)}"` : ""}>🔒 Lock it</button>`;
  box.hidden = false;
  const html = `<div class="mypick welcomecard">` +
    `<div class="mp-photo">${p.listing.photo ? `<img src="${esc(p.listing.photo)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : ""}</div>` +
    `<div class="mp-body"><span class="eyebrow">${who}</span><b>${esc(p.listing.title)}</b>` +
    `<small>${esc(p.resort.name)} · ${esc(p.walk)} · ${esc(p.when)}</small>` +
    `<div class="mp-price"><b>${euro(p.pp)} pp</b><small>all in · ${euro(p.group)} for ${p.people} · house ${euro(p.housePP)} pp</small></div></div>` +
    `<div class="wc-flight"><span class="wc-route">✈ ${esc(o.city)} (${esc(o.code)}) → ${esc(p.option.air)}</span>` +
    `<small>${t ? `${esc(t.airlines)} · ${hm(t.mins)} flight${t.stops ? ", 1 stop" : ", direct"} · ` : ""}${t ? hm(t.mins + p.option.mins) : esc(p.option.time)} door to door · out ${esc(rg.text.split(" → ")[0])}, back ${esc(rg.text.split(" → ")[1])}</small>` +
    `<a href="${esc(gf)}" target="_blank" rel="noopener noreferrer">See flights and times for these dates ↗</a></div>` +
    priceBreakdown(s, p) + result +
    `<div class="mp-acts wc-acts">${lock}<button type="button" class="btn secondary wc-explore" data-act="explore">Explore other options</button></div></div>`;
  // Redraw only when something changed: the sheet answering with the same pick mustn't swallow a tap on Explore.
  if (html !== welcomeHtml) { welcomeHtml = html; box.innerHTML = html; }
}

// ---- the "Your pick" bar, shown once a house is chosen
export function renderMyPick(s: State) {
  const box = $("mypick"), p = pickSummary(s), sp = tripId() ? sharedPlan() : null;
  // On a trip, the organiser's pick (house and flight) is already the welcome card at the top: no second copy here.
  if (!p || (sp && sp.listingId === s.pick && (sp.s.air || "") === (s.air || "") && !$("welcome").hidden)) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  // In a trip of the same group you add your pick to it; for another group you start (or open) that group's trip.
  const g = groupId(s.group), inTrip = !!tripId() && (!last || tripGroup() === g || !tripGroup()), own = myTrips()[g];
  // The same house, flight and dates as a pick already in the trip (the organiser's own, just after creating it).
  const added = inTrip ? last?.picks.find((x) => x.data.listingId === s.pick && x.data.airport === p.option.air && x.data.when === p.when) : undefined;
  // Already in the trip: your vote for it is one tap (Lock it), or done.
  const me = myName().toLowerCase(), votedIt = !!added && !!me && !!last?.votes.some((v) => v.pick === added.id && v.name.toLowerCase() === me);
  box.innerHTML = `<div class="mp-photo">${p.listing.photo ? `<img src="${esc(p.listing.photo)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : ""}</div>` +
    `<div class="mp-body"><span class="eyebrow">Your pick</span><b>${esc(p.listing.title)}</b>` +
    `<small>${esc(p.resort.name)} · ${esc(p.walk)} · ${esc(p.when)}</small>` +
    `<div class="mp-price"><b>${euro(p.pp)}</b><small>per person all in · ${euro(p.group)} group · house ${euro(p.housePP)} pp</small></div>` +
    `<label class="mp-air">✈ Flight <select id="mp-air">${p.flights.map((f) => {
      const t = SEASON.flightTimes[f.d.code];
      return `<option value="${esc(f.d.id)}"${f.d.id === p.option.id ? " selected" : ""}>${esc(f.d.air)}${t ? ` · ${hm(t.mins + f.d.mins)}` : ""} · ${euro(f.pp)} pp</option>`;
    }).join("")}</select></label></div>` +
    priceBreakdown(s, p) +
    `<div class="mp-acts">${tripsReady()
      ? added ? votedIt ? `<span class="foot">✓ In the trip, with your vote</span>`
          : `<button type="button" class="btn wc-lock" data-act="lock-it" data-pick="${esc(added.id)}">🔒 Lock it</button><span class="foot">This pick is in the trip</span>`
        : inTrip ? `<button type="button" class="btn" data-act="add-pick">Add my pick to the trip</button>`
        : own ? `<button type="button" class="btn" data-act="open-trip" data-trip="${esc(own)}">Open our ${esc(groupLabel(g).toLowerCase())} trip</button>`
        : `<button type="button" class="btn" data-act="create-trip">Create a trip for ${esc(groupLabel(g).toLowerCase())}</button>`
      : `<span class="foot">Shared trips aren't set up on this site yet.</span>`}` +
    `<button type="button" class="ghost" data-act="clear-pick">Clear</button></div>`;
}

// ---- "Top trips": the trips you can open, picked by group like in Filters. Couples and solo friends step
// only through numbers some trip has, and "where solo friends sleep" offers only the setups that have a trip.
// The organiser's own trips and the AI picks are listed for everyone; trips made or opened on this phone join them.
const FEATURED: { id: string; group: string; title: string; organizer: string; pp: number }[] = [
  { id: "50a313cf26", group: "4c", title: "4 couples · Thu 4 Mar → Tue 9 Mar", organizer: "Cristiano Miranda", pp: 999 },
  { id: "d44e47ce74", group: "4c", title: "4 couples · Thu 21 Jan → Tue 26 Jan", organizer: "AI pick (4 couples, comfort)", pp: 1152 },
  { id: "0353ac0c5a", group: "3c", title: "3 couples · Thu 4 Feb → Tue 9 Feb", organizer: "AI pick (3 couples with kids)", pp: 985 },
  { id: "f1f08c874d", group: "4c1", title: "4 couples + 1 friend (living room) · Thu 21 Jan → Tue 26 Jan", organizer: "AI pick (big group, après on a budget)", pp: 979 },
  { id: "95ac83b511", group: "4t", title: "4 friends, no couples (sharing 2 rooms) · Thu 21 Jan → Wed 27 Jan", organizer: "AI pick (4 male friends, focus on snow)", pp: 1286 },
  { id: "7de88c642a", group: "4s", title: "4 friends, no couples (own rooms) · Thu 21 Jan → Tue 26 Jan", organizer: "AI pick (4 friends, nightlife)", pp: 1504 },
  { id: "a34b374851", group: "4b", title: "4 friends, 4 separate beds (any rooms) · Thu 28 Jan → Tue 2 Feb", organizer: "AI pick (4 friends, cheapest)", pp: 904 },
];
type Sleep = "none" | "sofa" | "shared" | "own" | "twin" | "shared+sofa" | "own+sofa" | "twin+sofa";
const SLEEP_LABEL: Record<Sleep, string> = {
  none: "", sofa: "Sofa bed", shared: "Share a room", own: "Own room", twin: "Own bed, any room",
  "shared+sofa": "Share a room + sofa bed", "own+sofa": "Own room + sofa bed", "twin+sofa": "Own bed + sofa bed",
};
const sleepOf = (g0: Group): Sleep => {
  const g = normGroup(g0), r = g.soloRooms as "shared" | "own" | "twin"; // normGroup leaves no "common"
  return !g.solo ? "none" : g.livingRoom ? (g.solo === 1 ? "sofa" : `${r}+sofa` as Sleep) : r;
};
/** What the Top trips pickers show: starts on your own group, then follows the − / + and the sleeping deck. */
let topPick: { couples: number; solo: number; sleep: Sleep } | null = null;

interface TopTrip { id: string; g: Group; when: string; organizer: string; pp: number | null; yours: boolean }
function topTrips(): TopTrip[] {
  const seen = seenTrips(), mine = myTrips(), out = new Map<string, TopTrip>();
  const yours = new Set(Object.values(mine));
  for (const f of FEATURED) {
    const g = groupFromId(f.group); if (!g) continue;
    out.set(f.id, { id: f.id, g, when: f.title.split(" · ").slice(1).join(" · "), organizer: f.organizer, pp: f.pp, yours: yours.has(f.id) });
  }
  for (const [gid, id] of Object.entries(mine)) if (!seen[id]) seen[id] = { group: gid, title: "", organizer: "", at: 0 };
  for (const [id, t] of Object.entries(seen)) {
    const g = groupFromId(t.group); if (!g || out.has(id)) continue;
    out.set(id, { id, g, when: t.title.split(" · ").slice(1).join(" · "), organizer: t.organizer, pp: null, yours: yours.has(id) });
  }
  return [...out.values()];
}
export function setTopTrips(k: "couples" | "solo" | "sleep", v: number | string, s: State) {
  const all = topTrips(); if (!topPick) return;
  if (k === "sleep") topPick.sleep = v as Sleep;
  else {
    // − / + jump to the next number that has a trip; the other pickers follow to something that exists.
    const vals = [...new Set(all.filter((t) => k === "couples" || t.g.couples === topPick!.couples).map((t) => t.g[k]))].sort((a, b) => a - b);
    const i = vals.indexOf(topPick[k]), next = vals[Math.min(vals.length - 1, Math.max(0, i + (v as number)))];
    if (next == null) return;
    topPick[k] = next;
  }
  renderTripsByGroup(s);
}
export function renderTripsByGroup(s: State) {
  const box = document.getElementById("tripsbygroup"); if (!box) return;
  const block = $("trips-block");
  block.hidden = !tripsReady(); if (block.hidden) return;
  const all = topTrips(), here = tripId();
  if (!all.length) { box.innerHTML = `<p class="foot">No trips yet. Choose a house, then “Create a trip”.</p>`; return; }
  // Start on your own group when it has trips, else on the first one; then keep every picker on a value that exists.
  if (!topPick) {
    const g = normGroup(s.group), mineG = all.find((t) => groupId(t.g) === groupId(g))?.g || all[0].g;
    topPick = { couples: mineG.couples, solo: mineG.solo, sleep: sleepOf(mineG) };
  }
  const tp = topPick;
  const couplesVals = [...new Set(all.map((t) => t.g.couples))].sort((a, b) => a - b);
  if (!couplesVals.includes(tp.couples)) tp.couples = couplesVals[0];
  const byC = all.filter((t) => t.g.couples === tp.couples);
  const soloVals = [...new Set(byC.map((t) => t.g.solo))].sort((a, b) => a - b);
  if (!soloVals.includes(tp.solo)) tp.solo = soloVals[0];
  const byS = byC.filter((t) => t.g.solo === tp.solo);
  const sleeps = [...new Set(byS.map((t) => sleepOf(t.g)))];
  if (!sleeps.includes(tp.sleep)) tp.sleep = sleeps[0];
  const list = byS.filter((t) => sleepOf(t.g) === tp.sleep).sort((a, b) => (a.pp ?? 1e9) - (b.pp ?? 1e9));
  const stepper = (k: "couples" | "solo", vals: number[], label: string) => {
    const i = vals.indexOf(tp[k]);
    return `<div class="ctl"><span>${label}</span><div class="stepper" data-tk="${k}">` +
      `<button type="button" data-tstep="-1" aria-label="Fewer ${label.toLowerCase()}"${i <= 0 ? " disabled" : ""}>−</button><b>${tp[k]}</b>` +
      `<button type="button" data-tstep="1" aria-label="More ${label.toLowerCase()}"${i >= vals.length - 1 ? " disabled" : ""}>+</button></div></div>`;
  };
  const medal = ["🥇", "🥈", "🥉"];
  box.innerHTML = `<div class="groupctl tg-pick">${stepper("couples", couplesVals, "Couples")}${stepper("solo", soloVals, "Solo friends")}` +
    (tp.sleep !== "none" ? `<div class="ctl"><span>Solo friends sleep</span><div id="tg-sleep"></div></div>` : "") + `</div>` +
    `<ol class="tg-list">${list.map((t, i) => {
      const who = /^AI pick/i.test(t.organizer) ? `🤖 ${esc(t.organizer)}` : t.organizer ? `👋 ${esc(t.organizer)}` : "";
      return `<li class="tg-row${t.id === here ? " on" : ""}"><span class="tg-medal" aria-hidden="true">${medal[i] || "🎿"}</span>` +
        `<div class="tg-body"><b>${esc(t.when || "A trip")}</b><span class="foot">${who}${t.yours ? " · yours" : ""}${t.id === here ? " · open now" : ""}</span></div>` +
        (t.pp ? `<span class="tg-pp">${euro(t.pp)} <small>pp</small></span>` : "") +
        `<button type="button" class="btn secondary" data-act="open-trip" data-trip="${esc(t.id)}">Open</button></li>`;
    }).join("")}</ol>` +
    `<p class="foot">Cheapest first, per person all in. Your group isn't here? Set it in Filters, choose a house and “Create a trip”.</p>`;
  if (tp.sleep !== "none") renderDeck($("tg-sleep"), sleeps.map((v) => ({ v, label: SLEEP_LABEL[v] })), tp.sleep);
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
  // The games start the moment the name is in: they're there to cover the save and the reload (10–20 s).
  const saving = (async () => {
    const { trip } = await post({ action: "createTrip", name: a.name, title: `${groupLabel(groupId(s.group))} · ${p.when}`, reason: a.reason, data: pickData(s, p), parent: fromTrip() });
    rememberTrip(groupId(s.group), trip);
    history.pushState(null, "", `?trip=${trip}`);
    last = null;
    explored = true; // the organiser is already exploring: no welcome card for their own new trip
    await loadTrip(s, toast);
    renderMyPick(s);
    renderTrip(s);
    toast("Trip created. Copy the message below and paste it in your group chats.");
  })();
  playGames("🎉 Creating your trip", saving);
  try { await saving; } catch (e) {
    const old = (e as { trip?: string }).trip;
    if (old) { rememberTrip(groupId(s.group), old); toast(`${(e as Error).message} Opening it.`); openTrip(old, s, toast); return; }
    toast(`Couldn't create the trip: ${(e as Error).message}`);
  }
}
export async function addPick(s: State, toast: (m: string) => void) {
  const p = pickSummary(s); if (!p) return;
  const a = await ask("Add my pick", autoReason(p)); if (!a) return;
  // Straight away, under the pick: the pick is saved and the trip refreshes while they play.
  const saving = (async () => {
    await post({ action: "addPick", trip: tripId(), name: a.name, reason: a.reason, data: pickData(s, p) });
    toast(`Your pick is in, with your vote. ${last?.trip.organizer || "The organiser"} approves it before it's checked.`);
    await loadTrip(s, toast);
  })();
  playGames("🎉 Adding your pick", saving);
  try { await saving; } catch (e) { toast(`Couldn't add your pick: ${(e as Error).message}`); }
}
async function vote(pick: string, s: State, toast: (m: string) => void, done = "", sending?: () => void) {
  haptic(12);
  let name = myName();
  if (!name) { const a = await ask("Your name, to vote", null); if (!a) return; name = a.name; }
  sending?.();
  try { await post({ action: "vote", trip: tripId(), name, pick }); if (done) toast(done); await loadTrip(s, toast); }
  catch (e) { toast(`Couldn't vote: ${(e as Error).message}`); }
}

// ---- the trip panel at the top
let last: TripView | null = null;

let loader: LoaderHandle | null = null;
// Trips this browser has played the loading games for (or created): those open straight away next time.
// Each trip's answers and guess are kept, so a return visit opens straight on the pick with them.
const PLAYED_KEY = "snowfinder-played-v2";
type Played = Record<string, { answers: string[]; guess: number | null; at: number }>;
const playedAll = (): Played => {
  try {
    const v2 = JSON.parse(localStorage.getItem(PLAYED_KEY) || "null") as Played | null;
    if (v2) return v2;
    const v1 = JSON.parse(localStorage.getItem("snowfinder-played") || "[]") as string[]; // before answers were kept
    return Object.fromEntries(v1.map((id) => [id, { answers: [], guess: null, at: 0 }]));
  } catch { return {}; }
};
const markPlayed = (id: string, answers: string[], guess: number | null) => {
  try {
    const all = { ...playedAll(), [id]: { answers, guess, at: Date.now() } };
    const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 50);
    localStorage.setItem(PLAYED_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch { /* private mode */ }
};
// The last copy of each trip seen on this device, so a return visit shows it at once (then refreshes it).
const CACHE = (id: string) => `snowfinder-trip-${id}`;
const readCache = (id: string): TripView | null => { try { return JSON.parse(localStorage.getItem(CACHE(id)) || "null"); } catch { return null; } };
const writeCache = (id: string, t: TripView) => { try { localStorage.setItem(CACHE(id), JSON.stringify(t)); } catch { /* full or private */ } };

export async function loadTrip(s: State, toast: (m: string) => void) {
  const id = tripId(), box = $("trip-block");
  if (!id) { box.hidden = true; $("welcome").hidden = true; $("better-block").hidden = true; return; }
  box.hidden = false;
  if (!tripsReady()) { $("trip-body").innerHTML = `<p class="foot">This trip link needs the shared-trip sheet, which isn't set up on this copy of the site.</p>`; return; }
  // First load: the welcome card on top shows the organiser's pick straight away, from the link's snapshot or
  // this device's copy, while the sheet answers. The loading games no longer play here: they come after you
  // add a pick (or create the trip), below in step 5 (see playGames).
  const first = !last, body = $("trip-body"), welcome = $("welcome");
  let instant = false;
  if (first) {
    $("trip-loader").innerHTML = ""; body.innerHTML = ""; body.hidden = false;
    const cached = readCache(id);
    if (cached) { instant = true; last = cached; renderTrip(s); }
    if (cached || snapshot()) renderWelcome(welcomeLines());
    else if (!explored) { welcome.hidden = false; welcomeHtml = ""; welcome.innerHTML = WELCOME_LOADING; }
  }
  try {
    const t = await get(id); last = t; writeCache(id, t); renderTrip(s); renderMyPick(s);
    if (first) { renderWelcome(welcomeLines()); renderMyPick(s); }
  }
  catch (e) {
    if (first && !instant && !snapshot()) welcome.hidden = true;
    if (!instant) body.innerHTML = `<p class="foot">Couldn't load this trip: ${esc((e as Error).message)}.</p>`;
    else toast("Showing the last copy of this trip: couldn't refresh it.");
  }
}

/** The price of the trip's shared pick (the one on the welcome card), per person. */
function sharedPP(): number | null {
  const sp = sharedPlan(); if (!sp) return null;
  resetCache(); const pp = pickSummary(sp.s)?.pp ?? null; resetCache();
  return pp;
}
// The welcome card's lines: the organiser's guess and ski style, under their name. Only the organiser's:
// a visitor's own answers show below, in step 5, after they add a pick.
function welcomeLines() {
  const sp = sharedPlan(), oq = organizerQuiz(); if (!sp || !oq) return "";
  const who = /^AI pick/i.test(sp.organizer) ? "The AI" : sp.organizer.split(/\s+/)[0];
  return loaderResult(oq.answers, oq.guess, sharedPP(), who);
}

/** After adding a pick (or creating the trip): the ski-style questions and the price guess, right under the
 *  pick (step 4). Once both are done the price reveal plays, the games go away, and step 5 opens with the
 *  visitor's own lines on top. */
/** The two games under the pick, started as soon as it's sent; they open the votes once `saving` is done. */
function playGames(title: string, saving: Promise<unknown>) {
  const el = $("pick-games");
  loader?.stop();
  const l = loader = startLoader(el, {
    gate: true, first: "duel", target: el,
    title, intro: "2 quick games while it's saved →",
    gateLine: "🎯 Answer the questions and lock your guess to see the votes",
    doneLine: "✅ All done: opening the votes ↓",
    onReveal: (result) => setTimeout(() => {
      loader?.stop(); loader = null; el.innerHTML = "";
      $("trip-loader").innerHTML = result ? `<div class="mypick ld-mine">${result}</div>` : "";
      $("trip-block").classList.remove("collapsed");
      glide($("trip-block"));
    }, result ? 2600 : 0),
    // The organiser's play goes under the organiser's name: it shows on the welcome card for everyone.
    // A new trip has no id until it's saved, so the answers wait for it.
    onDone: (answers, guess) => saving.then(() => {
      const id = tripId(); if (!id) return;
      markPlayed(id, answers, guess);
      post({ action: "quiz", trip: id, name: myName(), answers, guess }).catch(() => { /* saved on this device anyway */ });
    }, () => { /* not saved: nothing to file them under */ }),
  });
  saving.then(() => { if (loader === l) l.ready(sharedPP()); }, () => { if (loader === l) { l.stop(); loader = null; } });
  glide(el);
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
function votesHtml(picks: Pick[], byPick: (id: string) => string[], mine: string) {
  if (!picks.length) return "";
  const xs = picks.map((p) => ({ p, f: facts(p.data), v: byPick(p.id) })).sort((a, b) => b.v.length - a.v.length);
  const total = xs.reduce((n, x) => n + x.v.length, 0), most = Math.max(1, ...xs.map((x) => x.v.length));
  const pc = total > 1 ? prosCons(xs) : null;
  const rows = xs.map((x, i) => {
    const c = pc?.get(x.p.id);
    return `<div class="tv-row"><div class="tv-top"><b>${x.v.length ? (MEDALS[i] || "•") + " " : ""}${esc(x.p.data.title)}</b><span class="num">${x.v.length} vote${x.v.length === 1 ? "" : "s"}</span></div>` +
      `<div class="tv-bar" aria-hidden="true"><span style="width:${((x.v.length / most) * 100).toFixed(0)}%"></span></div>` +
      `<small>${esc(x.p.data.resort)} · ${esc(x.p.data.when)}${x.v.length ? ` · ${x.v.map(esc).join(", ")}` : ""}</small>${checkDot(x.p)}` +
      (c ? `<ul class="tv-pc">${c.pros.map((t) => `<li class="pro">✅ ${esc(t)}</li>`).join("")}${c.cons.map((t) => `<li class="con">⚠️ ${esc(t)}</li>`).join("")}</ul>` : "") +
      `<div class="tv-acts"><button type="button" class="btn${mine === x.p.id ? "" : " secondary"}" data-vote="${esc(x.p.id)}" aria-pressed="${mine === x.p.id}">${mine === x.p.id ? "✓ Your vote" : "Vote for this"}</button>` +
      (safeUrl(x.p.data.url) ? `<a class="tp-open" href="${esc(safeUrl(x.p.data.url))}" target="_blank" rel="noopener noreferrer">View listing ↗</a>` : "") + `</div></div>`;
  }).join("");
  return `<div class="tvotes" id="votes"><h3 class="tsub">🗳️ Votes <span class="foot">${total} so far</span></h3>${rows}` +
      (pc ? "" : `<p class="foot">Pros and cons of each pick show up from 2 votes.</p>`) + `</div>`;
}
/** A pick's availability as a dot (green free, amber price changed, red gone or not checked) and when it was checked. */
function checkDot(p: Pick) {
  const at = when(p.checked);
  const [cls, text] = p.status === "available" ? ["ok", `Free · checked ${at}`]
    : p.status === "unavailable" ? ["bad", `Gone · checked ${at}`]
    : p.status === "changed" ? ["warn", `Price changed · checked ${at}`]
    : ["bad", "Not checked yet"];
  return `<span class="tcheck ${cls}"><i class="dot" aria-hidden="true"></i>${esc(text.replace(/ · checked $/, ""))}</span>`;
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
  // Step 4's title stays short (one line on a phone); the trip's own name sits on the line below it.
  $("trip-title").innerHTML = `<span class="step">4</span>Confirm availability`;
  // Keep the pressure visible: how many picks are still bookable, and loudly when the best one is gone.
  const checked = picks.filter((p) => p.status && p.status !== "unchecked");
  const free = checked.filter((p) => p.status !== "unavailable").length;
  const lastIso = checked.map((p) => p.checked || "").sort().pop();
  const alert = best?.status === "unavailable"
    ? `<div class="talert" role="alert">⚠ <b>${esc(trip.organizer)}'s pick is no longer available</b> for these dates. Vote for another pick below or choose a new one: places are going.</div>`
    : picks.some((p) => p.status === "unavailable") ? `<div class="talert warn" role="status">${picks.filter((p) => p.status === "unavailable").length} pick${picks.filter((p) => p.status === "unavailable").length > 1 ? "s are" : " is"} no longer available. Decide soon.</div>` : "";
  // One line: a red dot until the organiser has checked, then green with how many are still free and when.
  const pulse = checked.length
    ? `<p class="tpulse"><span class="dot" aria-hidden="true"></span>Availability checked · <b>${free} of ${checked.length}</b> still free · ${when(lastIso)}</p>`
    : `<p class="tpulse bad"><span class="dot" aria-hidden="true"></span>Availability not checked yet</p>`;
  // Free WhatsApp share: opens WhatsApp with the message ready; the sender picks the chat or group.
  const link = tripLink(last!);
  const bv = best ? verified(best.data) : null;
  const msg = best ? whatsappText(bv?.known ? { ...best.data, pp: Math.round(bv.pp) } : best.data, link) : `⛷️ Our ski trip: vote here ${link}`;
  // Three buttons on top: WhatsApp with the message ready, the promo image (Instagram) and the message to copy.
  const share = `<div class="tshare-top"><a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">WhatsApp</a>` +
    `<button type="button" class="btn secondary" data-act="promo">📸 Instagram</button>` +
    `<button type="button" class="btn secondary" data-act="copy-msg" data-text="${esc(msg)}">Copy text</button></div>`;
  const lim = last.limits;
  const others = Object.entries(myTrips()).filter(([, id]) => id !== trip.id);
  const limits = (lim ? `<p class="foot">${lim.peopleUsed} of ${lim.people} people on this trip · ${lim.tripsUsed} of ${lim.trips} trips</p>` : "") +
    (others.length ? `<p class="foot">Your other trips: ${others.map(([g, id]) => `<button type="button" class="linkbtn" data-act="open-trip" data-trip="${esc(id)}">${esc(groupLabel(g))}</button>`).join(" · ")}</p>` : "") +
    `<p class="foot">Another group? Pick it in Filters, choose a house and “Create a trip” for it: one trip per group.</p>`;
  const visible = [best, ...found, ...rest].filter((p): p is Pick => !!p);
  $("trip-body").innerHTML = share + `<p class="tname">Our trip${trip.title ? ` · ${esc(trip.title)}` : ""}</p>` + alert + pulse +
    votesHtml(visible, byPick, mine) + waitingNote(hiddenPicks.length, "pick") + limits;
  // "I have a better plan": its own section at the end of the page.
  $("better-block").hidden = false;
  $("better-body").innerHTML = `<h3 class="tsub">Pick your own</h3><p class="foot">Open steps 1–3 above: pick a week, “Choose this house”, a flight, then “Add my pick to the trip”.</p>` +
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
    const ts = t.closest<HTMLElement>("[data-tstep]");
    if (ts) { setTopTrips(ts.closest<HTMLElement>("[data-tk]")!.dataset.tk as "couples" | "solo", +ts.dataset.tstep!, getState()); haptic(8); return; }
    const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "create-trip") createTrip(getState(), toast);
    else if (act === "add-pick") addPick(getState(), toast);
    else if (act === "start-group") {
      const id = t.closest<HTMLElement>("[data-g]")!.dataset.g!, g = groupFromId(id);
      if (g) {
        update((s) => { s.group = { ...g }; s.pick = undefined; s.air = undefined; });
        document.getElementById("houses-block")?.scrollIntoView({ block: "start", behavior: "smooth" });
        toast(`Group set to ${groupLabel(id).toLowerCase()}. Choose a house, then “Create a trip”.`);
      }
    }
    else if (act === "open-trip") openTrip(t.closest<HTMLElement>("[data-trip]")!.dataset.trip!, getState(), toast);
    else if (act === "lock-it") {
      const pick = t.closest<HTMLElement>("[data-pick]")?.dataset.pick;
      if (!pick) toast("One second: the trip is still loading.");
      else {
        // Whoever added that pick (the organiser's, on the welcome card)
        const by = last?.picks.find((x) => x.id === pick)?.name || last?.trip.organizer || "";
        const whose = /^AI pick/i.test(by) ? "the AI's" : by ? `${by.split(/\s+/)[0]}'s` : "the organiser's";
        // "Locking…" at once (the sheet takes a few seconds), then "✓ Locked in" once the trip comes back with
        // the vote, or "Lock it" again if it didn't go through.
        const b = t.closest<HTMLButtonElement>("button")!;
        vote(pick, getState(), toast, `🔒 Locked in: your vote is on ${whose} pick.`, () => { b.disabled = true; b.textContent = "🔒 Locking…"; }).then(() => {
          welcomeHtml = ""; if (!$("welcome").hidden) renderWelcome(welcomeLines());
          // Locked: a moment on the tick, then on to the votes in step 4.
          if ($("welcome").querySelector(".wc-lock[aria-pressed='true']") || $("mypick").textContent!.includes("with your vote")) setTimeout(() => { $("trip-block").classList.remove("collapsed"); glide($("trip-block")); }, 1200);
        });
      }
    }
    else if (act === "explore") {
      // Close the card and let them look around from Dates; their "Your pick" bar comes back in step 4.
      explored = true; $("welcome").hidden = true; renderMyPick(getState()); haptic(10); glide($("grid-block"));
    }
    else if (act === "clear-pick") update((s) => { s.pick = undefined; s.air = undefined; });
    else if (act === "promo") {
      // The image of what you have chosen now ("Your pick"); with nothing chosen, the trip's top pick (the welcome
      // card). Both go with the trip link.
      const sp = sharedPlan(); if (!sp || !last) return;
      const s = getState(), link = tripLink(last);
      resetCache(); const mine = pickSummary(s); resetCache();
      resetCache(); const p = mine || pickSummary(sp.s); resetCache(); if (!p) return;
      const by = mine ? myName() || "" : sp.organizer;
      const who = /^AI pick/i.test(by) ? "🤖 AI pick" : by ? `👋 ${by.split(/\s+/)[0]} picked this` : "⛷️ Our ski trip plan";
      // The message to send with it, picked in the preview: the group message for this pick, or a vote nudge
      const invite = mine ? whatsappText(pickData(s, mine), link)
        : t.closest<HTMLElement>(".tshare-top")?.querySelector<HTMLElement>("[data-act='copy-msg']")?.dataset.text;
      openPromo(p, { who, link, toast, invite, vote: `🗳️ Haven't voted yet? Choose our snow trip here ❄️ ${link}` });
    }
    else if (act === "copy-msg") {
      const text = t.closest<HTMLElement>("[data-text]")!.dataset.text!;
      navigator.clipboard.writeText(text).then(() => toast("Text copied: paste it in your group chat."), () => window.prompt("Copy this:", text));
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
