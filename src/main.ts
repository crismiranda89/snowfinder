// Boot: restore state (a share link wins over this browser's saved state), render, wire up controls.
import { SEASON } from "./data.ts";
import type { Group } from "./types.ts";
import { decodeShare, encodeShare, load, save, type State } from "./state.ts";
import { rankOpen, renderHouseSection, type HouseView, renderControls, renderDests, renderHeat, renderRank, renderStatic, renderTable, renderWeeks, resetCache } from "./ui/render.ts";
import { applySort, initSort, wrapHeaders } from "./ui/sort.ts";

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

// How the Houses section groups its cards (this browser only).
let houseView: HouseView = "price";
try { if (localStorage.getItem("snowfinder-house-view") === "distance") houseView = "distance"; } catch { /* private mode */ }

function render() {
  resetCache();
  renderControls(state); renderDests(state); renderWeeks(state); renderHeat(state); renderRank(state, REPO); renderHouseSection(state, houseView, REPO); renderTable(state);
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
// The filters panel remembers whether it was open (this browser only); closed by default so the grid is in view.
const filters = $("filters") as HTMLDetailsElement;
try { filters.open = localStorage.getItem("snowfinder-filters-open") === "1"; } catch { /* private mode */ }
filters.addEventListener("toggle", () => { try { localStorage.setItem("snowfinder-filters-open", filters.open ? "1" : "0"); } catch { /* ignore */ } });
wrapHeaders(".detail"); wrapHeaders(".cmp");

seg("pattern", (s, v) => { s.pattern = v as State["pattern"]; });
seg("days", (s, v) => { s.days = +v as 4 | 5; });
seg("ground", (s, v) => { s.ground = v as State["ground"]; });
seg("house", (s, v) => { s.house = v as State["house"]; });
seg("soloRooms", (s, v) => { s.group.soloRooms = v as Group["soloRooms"]; });
num("couples", 0, 20, (s, v) => { s.group.couples = v; if (!s.group.couples && !s.group.solo) s.group.solo = 1; });
num("solo", 0, 20, (s, v) => { s.group.solo = v; if (!s.group.couples && !s.group.solo) s.group.couples = 1; });
$("foodPlan").addEventListener("change", (ev) => update((s) => { s.foodPlan = (ev.target as HTMLSelectElement).value as State["foodPlan"]; }));
$("food").addEventListener("input", (ev) => { const v = +(ev.target as HTMLInputElement).value; if (!Number.isFinite(v) || v < 0) return; update((s) => { s.food = v; }); });
($("nearLifts") as HTMLInputElement).addEventListener("change", (ev) => update((s) => { s.nearLifts = (ev.target as HTMLInputElement).checked; }));
($("limit") as HTMLInputElement).addEventListener("change", (ev) => update((s) => { s.limit = (ev.target as HTMLInputElement).checked; }));
$("weekinfo").addEventListener("click", (ev) => { const b = (ev.target as HTMLElement).closest<HTMLElement>(".linkbtn"); if (b) update((s) => { s.week = +b.dataset.w!; }); });
function pickCell(ev: Event) { const cell = (ev.target as HTMLElement).closest<HTMLElement>("td.cell"); if (cell) update((s) => { s.week = +cell.dataset.w!; }); }
$("heatbody").addEventListener("click", pickCell);
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
  renderHouseSection(state, houseView, REPO);
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

initSort(() => state, "heat", () => save(state));
initSort(() => state, "detail", () => save(state));
initSort(() => state, "cmp", () => save(state));
render();
applySort(state, "cmp");
