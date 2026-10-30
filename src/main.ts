// Boot: restore state (a share link wins over this browser's saved state), render, wire up controls.
import { LISTINGS, OPTIONS, SEASON } from "./data.ts";
import { range as seasonRange } from "./model/calendar.ts";
import { GROUPS, decodeShare, encodeShare, load, save, type State } from "./state.ts";
import { rankOpen, renderHouseSection, type HouseView, renderControls, renderDests, renderHeat, renderRank, renderStatic, renderTable, renderWeeks, resetCache } from "./ui/render.ts";
import { applySort, initSort, wrapHeaders } from "./ui/sort.ts";
import { loadTrip, renderMyPick, renderTripsByGroup, tripSettings, wireTrip } from "./trip.ts";

const REPO = (document.querySelector('a.btn.secondary') as HTMLAnchorElement | null)?.href.split("github.com/")[1] || "snowfinder/snowfinder";
const WEEKS = SEASON.weeks.length;
const $ = (id: string) => document.getElementById(id)!;

let state: State = load(WEEKS);
const shared = decodeShare(location.hash, WEEKS);
if (shared) {
  state = { ...shared, sort: state.sort };
  history.replaceState(null, "", location.pathname + location.search);
  toast("Opened a shared plan");
}
save(state);

// The Houses section shows every date (each house at its cheapest week) until a week is picked in the grid.
let weekChosen = false;
// How the Houses section groups its cards (this browser only).
let houseView: HouseView = "price";
try { if (localStorage.getItem("snowfinder-house-view") === "distance") houseView = "distance"; } catch { /* private mode */ }

function render() {
  resetCache();
  // The grid's title shows the week picked in it, or "All dates" until one is tapped.
  $("gridTitle").querySelector("b")!.textContent = weekChosen ? seasonRange(SEASON, state.pattern, state.week, state.days).text : "All weeks";
  $("allWeeks").hidden = !weekChosen;
  renderControls(state); renderDests(state); renderWeeks(state); renderHeat(state); renderRank(state, REPO); renderHouseSection(state, houseView, REPO, !weekChosen); renderMyPick(state); renderTripsByGroup(state); renderTable(state);
}
function update(mut: (s: State) => void) { mut(state); save(state); render(); }

function toast(msg: string) {
  const t = document.createElement("div");
  t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function seg(id: string, set: (s: State, v: string) => void) {
  $(id).addEventListener("click", (ev) => {
    const b = (ev.target as HTMLElement).closest("button"); if (!b || !b.dataset.v) return;
    update((s) => set(s, b.dataset.v!));
  });
}
function num(id: string, lo: number, hi: number, set: (s: State, v: number) => void) {
  $(id).addEventListener("input", (ev) => {
    const v = Math.round(+(ev.target as HTMLInputElement).value);
    if (!Number.isFinite(v) || v < lo || v > hi) return;
    update((s) => set(s, v));
  });
}

renderStatic();
// Every section folds when you tap its heading; which ones are folded is remembered (this browser only).
// v4: everyone starts again from the defaults (week grid and "Go deeper" folded, the rest open); v3 had
// saved the folds the steps make by themselves.
const FOLD_KEY = "snowfinder-folded-v4";
let folded: string[] = [];
try { folded = JSON.parse(localStorage.getItem(FOLD_KEY) || '["grid-block","deeper-block"]'); } catch { /* private mode */ }
const folds = new Map<string, (closed: boolean) => void>();
/** Only a tap on a heading is remembered; folding the page does by itself (next step, a trip link) is for this visit. */
function fold(key: string, closed: boolean, remember = true) {
  folds.get(key)?.(closed);
  if (!remember) return;
  folded = closed ? [...new Set([...folded, key])] : folded.filter((k) => k !== key);
  try { localStorage.setItem(FOLD_KEY, JSON.stringify(folded)); } catch { /* ignore */ }
}
/** The steps run in order: picking in one folds it and opens the next, scrolled into view. */
function advance(from: string, to: string | null, target: string) {
  fold(from, true, false); if (to) fold(to, false, false);
  requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ block: "start", behavior: "smooth" }));
}
document.querySelectorAll<HTMLElement>("section.block").forEach((sec, i) => {
  const h2 = sec.querySelector<HTMLElement>(":scope > h2, :scope > .head > h2"); if (!h2) return;
  const key = sec.id || `section-${i}`;
  (h2.parentElement === sec ? h2 : h2.parentElement!).classList.add("sechead");
  h2.classList.add("fold"); h2.tabIndex = 0; h2.setAttribute("role", "button");
  const set = (closed: boolean) => { sec.classList.toggle("collapsed", closed); h2.setAttribute("aria-expanded", String(!closed)); };
  folds.set(key, set);
  set(folded.includes(key));
  const toggle = () => fold(key, !sec.classList.contains("collapsed"));
  h2.addEventListener("click", toggle);
  h2.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(); } });
});

// The filters panel remembers whether it was open (this browser only); closed by default so the grid is in view.
const filters = $("filters") as HTMLDetailsElement;
try { filters.open = localStorage.getItem("snowfinder-filters-open") === "1"; } catch { /* private mode */ }
filters.addEventListener("toggle", () => { try { localStorage.setItem("snowfinder-filters-open", filters.open ? "1" : "0"); } catch { /* ignore */ } });
wrapHeaders(".detail"); wrapHeaders(".cmp");

seg("pattern", (s, v) => { s.pattern = v as State["pattern"]; });
seg("days", (s, v) => { s.days = +v as 4 | 5; });
seg("ground", (s, v) => { s.ground = v as State["ground"]; });
seg("house", (s, v) => { s.house = v as State["house"]; });
$("groupPreset").innerHTML = GROUPS.map((g) => `<option value="${g.id}">${g.label}</option>`).join("");
$("groupPreset").addEventListener("change", (ev) => { const g = GROUPS.find((x) => x.id === (ev.target as HTMLSelectElement).value); if (g) update((s) => { s.group = { ...g.group }; }); });
$("foodPlan").addEventListener("change", (ev) => update((s) => { s.foodPlan = (ev.target as HTMLSelectElement).value as State["foodPlan"]; }));
$("food").addEventListener("input", (ev) => { const v = +(ev.target as HTMLInputElement).value; if (!Number.isFinite(v) || v < 0) return; update((s) => { s.food = v; }); });
seg("lift", (s, v) => { s.liftBand = v as State["liftBand"]; });
$("weekinfo").addEventListener("click", (ev) => { const b = (ev.target as HTMLElement).closest<HTMLElement>(".linkbtn"); if (b) { weekChosen = true; update((s) => { s.week = +b.dataset.w!; }); advance("grid-block", "houses-block", "houses-block"); } });
function pickCell(ev: Event) { const cell = (ev.target as HTMLElement).closest<HTMLElement>("td.cell"); if (cell) { weekChosen = true; update((s) => { s.week = +cell.dataset.w!; }); advance("grid-block", "houses-block", "houses-block"); } }
$("houseslede").addEventListener("click", (ev) => { if ((ev.target as HTMLElement).closest("[data-act='all-dates']")) { weekChosen = false; render(); } });
// Choosing a house sets its week, and its quote's start day and length when it has one (trip.ts), so the
// houses, grid and ranking all show those dates; its resort opens in the ranking.
document.addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest<HTMLElement>(".choose"); if (!b) return;
  const fromStep2 = !!b.closest("#houses-block");
  weekChosen = true;
  const l = LISTINGS.find((x) => x.id === b.dataset.pick), d = l && OPTIONS.find((o) => o.resort === l.resort);
  if (d) { rankOpen.add("a:" + d.region); rankOpen.add("r:" + d.resort); }
  // After trip.ts has stored the pick: a house chosen (not un-chosen) moves on to its flights.
  // Only from step 2: a house chosen inside "Flights and others" keeps you where you are.
  setTimeout(() => { if (fromStep2 && state.pick === b.dataset.pick) advance("houses-block", "rank-block", d ? "rank-block" : "mypick"); });
}, true);
// Step 3: choosing a flight for your house moves on to your pick (and the trip).
document.addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest<HTMLElement>("[data-act='pick-air']"); if (!b) return;
  update((s) => { s.air = b.dataset.air; });
  advance("rank-block", "trip-block", "mypick");
});
$("heatbody").addEventListener("click", pickCell);
$("allWeeks").addEventListener("click", () => { weekChosen = false; render(); });
$("heatbody").addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pickCell(ev); } });
$("tbody").addEventListener("change", (ev) => {
  const t = ev.target as HTMLInputElement; if (!t.dataset || !t.dataset.f) return;
  const v = +t.value; if (!Number.isFinite(v) || v < 0) return;
  const k = t.dataset.id + "@" + state.week;
  update((s) => { s.edits[k] = s.edits[k] || {}; (s.edits[k] as Record<string, number>)[t.dataset.f!] = v; });
  (document.getElementById(t.id) as HTMLInputElement | null)?.focus();
});
$("dests").addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest<HTMLElement>(".chip"); if (!b) return;
  const r = b.dataset.r!;
  update((s) => {
    if (!r) { s.dest = []; return; }
    const i = s.dest.indexOf(r); if (i >= 0) s.dest.splice(i, 1); else s.dest.push(r);
  });
});
// Remember which area / resort groups are expanded so a re-render keeps them ("toggle" doesn't bubble).
$("rank").addEventListener("toggle", (ev) => {
  const d = ev.target as HTMLDetailsElement; const k = d.dataset?.k; if (!k) return;
  if (d.open) rankOpen.add(k); else rankOpen.delete(k);
}, true);
$("reset").addEventListener("click",() => update((s) => { s.edits = {}; s.food = 40; }));

// Photos that fail to load (moved listing, hotlink blocked) fall back to the placeholder.
$("houseView").addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest<HTMLElement>("button"); if (!b?.dataset.v) return;
  houseView = b.dataset.v as HouseView;
  try { localStorage.setItem("snowfinder-house-view", houseView); } catch { /* ignore */ }
  renderHouseSection(state, houseView, REPO, !weekChosen);
});
document.addEventListener("error", (ev) => {
  const img = ev.target as HTMLElement;
  if (img.tagName !== "IMG") return;
  const a = img.parentElement!;
  img.remove(); a.querySelector(".credit")?.remove();
  a.insertAdjacentHTML("afterbegin", `<span class="ph"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 52h48M14 52V28l18-14 18 14v24M26 52V38h12v14" fill="none" stroke="currentColor" stroke-width="3"/></svg></span>`);
}, true);

$("share").addEventListener("click", async () => {
  const url = location.origin + location.pathname + "#" + encodeShare(state);
  try {
    if (navigator.share && matchMedia("(pointer:coarse)").matches) { await navigator.share({ title: "Our ski trip plan · Snowfinder", url }); return; }
    await navigator.clipboard.writeText(url);
    toast("Link copied. Anyone who opens it sees this exact plan.");
  } catch {
    window.prompt("Copy this link:", url);
  }
});

// Page style (this browser only): classic, piste or après. The <head> applies it before the first paint.
const STYLE_KEY = "snowfinder-style";
function setStyle(v: string) {
  if (v === "piste" || v === "apres") document.documentElement.dataset.style = v; else delete document.documentElement.dataset.style;
  const cur = document.documentElement.dataset.style || "classic";
  $("pageStyle").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === cur)));
}
setStyle(document.documentElement.dataset.style || "classic");
$("pageStyle").addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest<HTMLElement>("button"); if (!b?.dataset.v) return;
  setStyle(b.dataset.v);
  try { localStorage.setItem(STYLE_KEY, b.dataset.v); } catch { /* private mode */ }
});

initSort(() => state, "heat", () => save(state));
initSort(() => state, "detail", () => save(state));
initSort(() => state, "cmp", () => save(state));
render();
applySort(state, "cmp");
wireTrip(() => state, update, toast);
// A trip link lands on the trip (step 5), below the steps.
// A trip link shows the trip first: steps 1–3 fold for this visit, so the trip sits right under the header.
const onTrip = !!new URLSearchParams(location.search).get("trip");
if (onTrip) { for (const k of ["grid-block", "houses-block", "rank-block"]) fold(k, true, false); fold("trip-block", false, false); }
// Once it has loaded, jump to it (no animation) unless the visitor has already scrolled.
// The trip's group and dates become the visitor's, so "Add my pick" fits the trip (unless they already picked).
loadTrip(state, toast).then(() => {
  const t = onTrip && !state.pick ? tripSettings() : null;
  if (t) { weekChosen = true; update((s) => { Object.assign(s, t, { group: { ...t.group } }); }); }
  if (onTrip && scrollY < 40) $("trip-block").scrollIntoView({ block: "start" });
});
