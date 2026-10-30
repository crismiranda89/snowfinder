// A compact one-of-many picker drawn as a stacked deck of cards: the chosen option on top, the others
// peeking out behind it. Tap the deck and the options drop down one after another; pick one and it folds
// back into the deck. Used in the pinned bar and in Filters instead of rows of pills or a dropdown.
import { esc } from "./render.ts";
import { haptic } from "./haptic.ts";

export interface DeckOpt { v: string; label: string }

/** Draws (or redraws) the deck in `host` with `value` on top; an open deck stays open. */
export function renderDeck(host: HTMLElement, opts: DeckOpt[], value: string, prefix = "") {
  const cur = opts.find((o) => o.v === value) || opts[0], open = host.classList.contains("open");
  const others = opts.filter((o) => o !== cur).length;
  host.classList.add("deck");
  host.innerHTML =
    `<button type="button" class="deck-top" aria-haspopup="listbox" aria-expanded="${open}">` +
    (others > 1 ? `<span class="deck-ghost g2" aria-hidden="true"></span>` : "") +
    (others > 0 ? `<span class="deck-ghost g1" aria-hidden="true"></span>` : "") +
    `<span class="deck-face">${prefix ? `<span class="deck-pre">${prefix}</span>` : ""}<span class="deck-label">${esc(cur.label)}</span><span class="deck-caret" aria-hidden="true">▾</span></span></button>` +
    `<div class="deck-menu" role="listbox">${opts.map((o, i) =>
      `<button type="button" class="deck-opt" role="option" data-v="${esc(o.v)}" aria-selected="${o === cur}" style="--i:${i}">${esc(o.label)}</button>`).join("")}</div>`;
}

const closeAll = (except?: Element) => document.querySelectorAll(".deck.open").forEach((d) => {
  if (d === except) return;
  d.classList.remove("open"); d.querySelector(".deck-top")?.setAttribute("aria-expanded", "false");
});

/** One listener for every deck: `pick(deckId, value)` applies a choice. */
export function wireDecks(pick: (id: string, v: string) => void) {
  document.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement, deck = t.closest<HTMLElement>(".deck");
    if (!deck) { closeAll(); return; }
    const opt = t.closest<HTMLElement>(".deck-opt");
    if (opt) {
      closeAll(); haptic(12);
      if (opt.getAttribute("aria-selected") !== "true") pick(deck.id, opt.dataset.v!);
      return;
    }
    if (t.closest(".deck-top")) {
      const open = !deck.classList.contains("open");
      closeAll(deck); deck.classList.toggle("open", open);
      deck.querySelector(".deck-top")!.setAttribute("aria-expanded", String(open));
      haptic(8);
    }
  });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeAll(); });
}
