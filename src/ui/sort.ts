// Click-to-sort for every table, ported from the original simulator. The sort choice is kept in state.
import type { State } from "../state.ts";

const TABLES: Record<string, string> = { heat: ".heat", detail: ".detail", cmp: ".cmp" };
const WIND: Record<string, number> = { Low: 1, Medium: 2, High: 3 };

export function sortBtn(label: string) { return `<button type="button" class="sorth">${label}</button>`; }

function cellVal(td: HTMLTableCellElement | undefined): number | string | null {
  if (!td) return "";
  const v = td.getAttribute("data-v");
  if (v === "closed") return null;
  if (v != null && v !== "" && !isNaN(+v)) return +v;
  if (v != null && v !== "") return v.toLowerCase();
  const inp = td.querySelector("input"); if (inp) return +inp.value;
  const stars = td.querySelector(".stars"); if (stars) return parseInt(stars.getAttribute("aria-label")!, 10);
  const risk = td.querySelector(".risk"); if (risk) return WIND[risk.textContent!.trim()] || 0;
  const t = td.textContent!.replace(/−/g, "-").replace(/\s/g, " ").trim();
  const m = t.match(/-?\d+([.,]\d+)?/);
  if (m && t.indexOf(m[0]) < 4) return parseFloat(m[0].replace(",", "."));
  return t.toLowerCase();
}

export function applySort(s: State, key: string) {
  const table = document.querySelector<HTMLTableElement>(TABLES[key]); if (!table) return;
  const ths = table.querySelectorAll("thead th");
  ths.forEach((th) => th.setAttribute("aria-sort", "none"));
  const cfg = s.sort[key]; if (!cfg) return;
  const th = ths[cfg.col]; if (!th) return;
  th.setAttribute("aria-sort", cfg.dir > 0 ? "ascending" : "descending");
  const tb = table.tBodies[0];
  const rows = Array.from(tb.rows);
  rows.sort((a, b) => {
    const x = cellVal(a.cells[cfg.col]), y = cellVal(b.cells[cfg.col]);
    if (x === null && y === null) return 0; if (x === null) return 1; if (y === null) return -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * cfg.dir;
    return String(x).localeCompare(String(y), "en") * cfg.dir;
  });
  rows.forEach((r) => tb.appendChild(r));
}

export function initSort(s: () => State, key: string, onChange: () => void) {
  const table = document.querySelector<HTMLTableElement>(TABLES[key])!;
  table.querySelector("thead")!.addEventListener("click", (ev) => {
    const b = (ev.target as HTMLElement).closest(".sorth"); if (!b) return;
    const th = b.closest("th")!; const col = Array.prototype.indexOf.call(th.parentNode!.children, th);
    const st = s(), cur = st.sort[key];
    st.sort[key] = { col, dir: cur && cur.col === col ? (-cur.dir as 1 | -1) : 1 };
    onChange(); applySort(st, key);
  });
}

export function wrapHeaders(sel: string) {
  document.querySelectorAll(sel + " thead th").forEach((th) => { if (!th.querySelector(".sorth")) th.innerHTML = sortBtn(th.innerHTML); });
}
