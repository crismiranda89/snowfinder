// While a trip loads (the Google Sheet takes 5–10 s), a slider of three small widgets keeps the visitor here:
// "snow" (falling snow and rotating lines), "duel" (quick taps: ski or board, …) and "guess" (guess the price
// per person; the trip then shows how close it was). Swipe between them; ?loader=snow|duel|guess picks the
// one shown first. One of them may become the only one later.
import { euro } from "./ui/render.ts";

export type Loader = "snow" | "duel" | "guess";
const ORDER: Loader[] = ["snow", "duel", "guess"];

export function loaderVariant(): Loader {
  const q = new URLSearchParams(location.search).get("loader");
  return q === "duel" || q === "guess" ? q : "snow";
}

const LINES = [
  "Waxing the skis…", "Checking the house is still free…", "Counting the votes…", "Warming up the fondue…",
  "Looking for the shortest lift queue…", "Packing the goggles…", "Asking the snow forecast nicely…",
];
const QUESTIONS: { q: string; a: [string, string] }[] = [
  { q: "Ski or snowboard?", a: ["⛷️ Ski", "🏂 Board"] },
  { q: "First lift or lie-in?", a: ["🌅 First lift", "😴 Lie-in"] },
  { q: "Après-ski or early night?", a: ["🍻 Après", "🛌 Early night"] },
  { q: "Fondue or pizza on the slopes?", a: ["🫕 Fondue", "🍕 Pizza"] },
];
let guess: number | null = null;
let answers: string[] = [];
/** Set once the trip has loaded: the top pick's price per person, to score a guess locked in afterwards. */
let real: number | null = null;
const verdict = (g: number, r: number) => {
  const pct = Math.abs(g - r) / r;
  return pct <= 0.05 ? "🏆 Spot on!" : pct <= 0.15 ? "👏 So close!" : pct <= 0.3 ? "Not bad." : g > r ? "Good news: it's cheaper." : "Ouch, a bit more than you hoped.";
};

const flakes = Array.from({ length: 18 }, (_, i) =>
  `<i style="left:${(i * 53) % 100}%;animation-delay:${((i * 37) % 30) / 10}s;animation-duration:${3 + ((i * 17) % 30) / 10}s;font-size:${10 + ((i * 7) % 12)}px">❄</i>`).join("");
const duelHtml = () => {
  const n = answers.length;
  return n < QUESTIONS.length
    ? `<b>⛷️ Ski or board?</b><span class="ld-q">${QUESTIONS[n].q}</span>` +
      `<div class="ld-acts">${QUESTIONS[n].a.map((a) => `<button type="button" class="btn secondary" data-ans="${a}">${a}</button>`).join("")}</div>` +
      `<span class="foot">${n + 1} of ${QUESTIONS.length}</span>`
    : `<b>⛷️ Your ski style</b><span class="ld-q">${answers.join(" · ")}</span><span class="foot">Swipe for the next one →</span>`;
};

/** Shows the slider in `el`; call the returned function when the trip has loaded. */
export function startLoader(el: HTMLElement, first: Loader): () => void {
  guess = null; answers = []; real = null;
  const panes: Record<Loader, string> = {
    snow: `<div class="ld-flakes" aria-hidden="true">${flakes}</div><b>❄️ Opening your trip</b><span class="ld-line">${LINES[0]}</span><span class="foot">Swipe for a quick game →</span>`,
    duel: duelHtml(),
    guess: `<b>🎯 Guess the price</b><span class="ld-q">Per person, all in: flight, house, lift pass, rental and food?</span>` +
      `<output class="ld-val">€1,200</output>` +
      `<input type="range" min="500" max="3000" step="50" value="1200" aria-label="Your guess, euros per person">` +
      `<button type="button" class="btn" data-act="lock-guess">Lock my guess</button>`,
  };
  el.innerHTML = `<div class="ld" role="status" aria-label="Loading the trip">` +
    `<div class="ld-slider">${ORDER.map((k) => `<section class="ld-pane ld-${k}" data-k="${k}">${panes[k]}</section>`).join("")}</div>` +
    `<div class="ld-dots">${ORDER.map((k, i) => `<button type="button" data-go="${i}" aria-label="Show ${k}"></button>`).join("")}</div>` +
    `<div class="ld-bar" aria-hidden="true"><span></span></div></div>`;
  const slider = el.querySelector<HTMLElement>(".ld-slider")!, dots = [...el.querySelectorAll<HTMLElement>(".ld-dots button")];
  const at = () => Math.round(slider.scrollLeft / Math.max(1, slider.clientWidth));
  const mark = () => dots.forEach((d, i) => d.setAttribute("aria-current", String(i === at())));
  slider.addEventListener("scroll", mark, { passive: true });
  requestAnimationFrame(() => { slider.scrollLeft = ORDER.indexOf(first) * slider.clientWidth; mark(); });

  let i = 0;
  const timer = window.setInterval(() => { const l = el.querySelector(".ld-line"); if (l) l.textContent = LINES[++i % LINES.length]; }, 1800);
  const range = el.querySelector<HTMLInputElement>("input[type=range]")!, out = el.querySelector("output")!;
  range.oninput = () => { out.textContent = euro(+range.value); guess = +range.value; };
  el.onclick = (ev) => {
    const t = ev.target as HTMLElement;
    const go = t.closest<HTMLElement>("[data-go]");
    if (go) slider.scrollTo({ left: +go.dataset.go! * slider.clientWidth, behavior: "smooth" });
    const ans = t.closest<HTMLElement>("[data-ans]");
    if (ans) { answers.push(ans.dataset.ans!); el.querySelector(".ld-duel")!.innerHTML = duelHtml(); }
    if (t.closest("[data-act='lock-guess']")) {
      guess = +range.value;
      el.querySelector(".ld-guess")!.innerHTML = real
        ? `<b>🎯 ${euro(guess)} vs ${euro(real)}</b><span class="ld-q">${verdict(guess, real)}</span>`
        : `<b>🎯 ${euro(guess)} locked in</b><span class="ld-q">Let's see how close you are…</span>`;
    }
  };
  return () => { clearInterval(timer); el.onclick = null; };
}

/** The trip has loaded: the slider keeps playing, says so, and the page glides down to the trip. */
export function loaderReady(el: HTMLElement, realPP: number | null, target: HTMLElement) {
  real = realPP;
  const ld = el.querySelector(".ld"); if (!ld) return;
  ld.classList.add("ready");
  ld.insertAdjacentHTML("beforeend", `<button type="button" class="ld-nudge" data-act="to-trip">✅ Your trip is ready ↓</button>`);
  el.querySelector<HTMLElement>("[data-act='to-trip']")!.onclick = () => glide(target);
  setTimeout(() => glide(target), 900);
}
/** A slow scroll (about 1.6 s, eased) so the slider drifts up while its animations keep going. */
function glide(target: HTMLElement) {
  const from = scrollY, to = from + target.getBoundingClientRect().top - 96, t0 = performance.now(), d = 1600;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { scrollTo(0, to); return; }
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / d), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    scrollTo(0, from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Lines for the top of the trip once it has loaded: how close the guess was, and the quick answers. */
export function loaderResult(realPP: number | null): string {
  let out = "";
  if (guess != null && realPP) out += `<p class="ld-result">🎯 You guessed <b>${euro(guess)}</b>, the top pick is <b>${euro(realPP)}</b> per person: ${verdict(guess, realPP)}</p>`;
  if (answers.length) out += `<p class="ld-result">⛷️ Your ski style: ${answers.join(" · ")}</p>`;
  return out;
}
