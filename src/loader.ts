// While a trip saves or loads (the Google Sheet takes 5–10 s), a slider of two cards keeps the visitor here:
// "snow" (falling snow and rotating lines) and "duel" (four quick taps: ski or board, …). The trip opens once
// the questions are answered and it has loaded. The answers go to the sheet (see trip.ts). No price guess:
// the price is already on the pick. ?loader=snow|duel picks the card shown first.
import { esc } from "./ui/render.ts";
import { haptic } from "./ui/haptic.ts";

export type Loader = "snow" | "duel";
const ORDER: Loader[] = ["snow", "duel"];

export function loaderVariant(): Loader {
  const q = new URLSearchParams(location.search).get("loader");
  return q === "duel" ? q : "snow";
}

const LINES = [
  "Waxing the skis…", "Checking the house is still free…", "Counting the votes…", "Warming up the fondue…",
  "Looking for the shortest lift queue…", "Packing the goggles…", "Asking the snow forecast nicely…",
];
// The answers must match QUIZ in sheet/Code.gs, which drops anything else.
const QUESTIONS: { q: string; a: [string, string] }[] = [
  { q: "Ski or snowboard?", a: ["⛷️ Ski", "🏂 Board"] },
  { q: "First lift or lie-in?", a: ["🌅 First lift", "😴 Lie-in"] },
  { q: "Après-ski or early night?", a: ["🍻 Après", "🛌 Early night"] },
  { q: "Fondue or pizza on the slopes?", a: ["🫕 Fondue", "🍕 Pizza"] },
];
const flakes = Array.from({ length: 18 }, (_, i) =>
  `<i style="left:${(i * 53) % 100}%;animation-delay:${((i * 37) % 30) / 10}s;animation-duration:${3 + ((i * 17) % 30) / 10}s;font-size:${10 + ((i * 7) % 12)}px">❄</i>`).join("");

export interface LoaderOpts {
  /** First visit: the trip stays hidden until the questions are answered. */
  gate: boolean;
  first: Loader;
  /** The trip element the page glides to once it opens. */
  target: HTMLElement;
  /** Called once, when the trip opens; `result` is the lines to show on top of it. */
  onReveal: (result: string) => void;
  /** The first card's heading and the line under it (default: opening the trip). */
  title?: string;
  intro?: string;
  /** The line under the slider while the games aren't done, and once they are (default: about opening the trip). */
  gateLine?: string;
  doneLine?: string;
  /** Called once the questions are answered, with what to save. */
  onDone: (answers: string[]) => void;
}
export interface LoaderHandle {
  /** The trip has loaded; `skipGate` opens it without the games (the organiser, or someone who already played). */
  ready(skipGate?: boolean): void;
  stop(): void;
}

/** Shows the slider in `el`. Call ready() when the trip has loaded and stop() if it fails. */
export function startLoader(el: HTMLElement, o: LoaderOpts): LoaderHandle {
  const answers: string[] = [];
  let gate = o.gate;
  let loaded = false, revealed = false, saved = false;
  const games = o.intro ? `<span class="ld-gate">${esc(o.intro)}</span>` : o.gate ? `<span class="ld-gate">A quick game before your trip opens →</span>` : `<span class="foot">Swipe for a quick game →</span>`;
  el.innerHTML = `<div class="ld" role="status" aria-label="Loading the trip">` +
    `<div class="ld-slider">` +
    `<section class="ld-pane ld-snow"><div class="ld-flakes" aria-hidden="true">${flakes}</div><b>${esc(o.title || "❄️ Opening your trip")}</b><span class="ld-line">${LINES[0]}</span>${games}</section>` +
    `<section class="ld-pane ld-duel"><div class="ld-card"></div></section></div>` +
    `<div class="ld-dots">${ORDER.map((k, i) => `<button type="button" data-go="${i}" aria-label="Show ${k}"></button>`).join("")}</div>` +
    `<div class="ld-bar" aria-hidden="true"><span></span></div><div class="ld-foot"></div></div>`;
  const slider = el.querySelector<HTMLElement>(".ld-slider")!, dots = [...el.querySelectorAll<HTMLElement>(".ld-dots button")];
  const duel = el.querySelector<HTMLElement>(".ld-duel .ld-card")!;
  const foot = el.querySelector<HTMLElement>(".ld-foot")!;
  const at = () => Math.round(slider.scrollLeft / Math.max(1, slider.clientWidth));
  const mark = () => dots.forEach((d, i) => d.setAttribute("aria-current", String(i === at())));
  const go = (i: number) => slider.scrollTo({ left: i * slider.clientWidth, behavior: "smooth" });
  slider.addEventListener("scroll", mark, { passive: true });
  requestAnimationFrame(() => { slider.scrollLeft = ORDER.indexOf(o.first) * slider.clientWidth; mark(); });

  const drawDuel = () => {
    const n = answers.length;
    duel.innerHTML = n < QUESTIONS.length
      ? `<b>⛷️ Your ski style</b><span class="ld-q">${QUESTIONS[n].q}</span>` +
        `<div class="ld-acts">${QUESTIONS[n].a.map((a) => `<button type="button" class="ld-opt" data-ans="${a}">${a}</button>`).join("")}</div>` +
        `<div class="ld-steps">${QUESTIONS.map((_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</div>`
      : `<span class="ld-check" aria-hidden="true">✓</span><b>${answers.join(" · ")}</b><span class="foot">All done</span>`;
  };
  const tryOpen = () => {
    const done = answers.length === QUESTIONS.length;
    if (done && !saved) { saved = true; o.onDone(answers.slice()); }
    if (revealed) return;
    // Games done before the sheet has answered: say it's still on its way, not stuck.
    if (!loaded) { if (done) foot.innerHTML = `<span class="ld-gate">⏳ All done, almost there: still saving…</span>`; return; }
    if (gate && !done) {
      foot.innerHTML = `<span class="ld-gate">${esc(o.gateLine || "🔓 Your trip is ready: answer the questions to open it")}</span>`;
      go(1);
      return;
    }
    revealed = true;
    el.querySelector(".ld")!.classList.add("ready");
    foot.innerHTML = `<button type="button" class="ld-nudge" data-act="to-trip">${esc(o.doneLine || "✅ Your trip is ready ↓")}</button>`;
    o.onReveal(loaderResult(answers));
    setTimeout(() => glide(o.target), 900);
  };

  drawDuel();
  let i = 0;
  const timer = window.setInterval(() => { const l = el.querySelector(".ld-line"); if (l) l.textContent = LINES[++i % LINES.length]; }, 1800);
  el.onclick = (ev) => {
    const t = ev.target as HTMLElement;
    const g = t.closest<HTMLElement>("[data-go]"); if (g) go(+g.dataset.go!);
    if (t.closest("[data-act='to-trip']")) glide(o.target);
    // An answer: the chosen pill springs and fills with a tick, the other fades, then the next question slides in.
    const a = t.closest<HTMLElement>("[data-ans]");
    if (a && !duel.classList.contains("busy")) {
      duel.classList.add("busy"); haptic(12);
      a.classList.add("picked"); a.insertAdjacentHTML("beforeend", `<span class="ld-tick">✓</span>`);
      duel.querySelectorAll(".ld-opt").forEach((b) => { if (b !== a) b.classList.add("dim"); });
      answers.push(a.dataset.ans!);
      setTimeout(() => {
        duel.classList.add("out");
        setTimeout(() => {
          drawDuel(); duel.classList.remove("out", "busy"); duel.classList.add("in");
          setTimeout(() => duel.classList.remove("in"), 320);
          if (answers.length === QUESTIONS.length) tryOpen();
        }, 220);
      }, 420);
    }
  };
  return {
    ready(skipGate) { loaded = true; if (skipGate) gate = false; tryOpen(); },
    stop() { clearInterval(timer); el.onclick = null; el.innerHTML = ""; },
  };
}

/** A slow scroll (about 1.6 s, eased) so the slider drifts up while its animations keep going. */
export function glide(target: HTMLElement) {
  const from = scrollY, to = from + target.getBoundingClientRect().top - 96, t0 = performance.now(), d = 1600;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { scrollTo(0, to); return; }
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / d), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    scrollTo(0, from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** The quick answers as a line for the card. `who` names someone else (the organiser); without it the line is
 *  about the visitor ("Your ski style"). */
export function loaderResult(answers: string[], who = ""): string {
  const style = who ? `${esc(who)}'s ski style` : "Your ski style";
  return answers.length ? `<p class="ld-result">⛷️ ${style}: ${answers.join(" · ")}</p>` : "";
}
