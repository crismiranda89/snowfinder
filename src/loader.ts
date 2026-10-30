// While a trip loads (the Google Sheet takes 5–10 s), a slider of three cards keeps the visitor here: "snow"
// (falling snow and rotating lines), "duel" (four quick taps: ski or board, …) and "guess" (guess the price
// per person). On a first visit the two games come first: the trip opens once both are done and it has
// loaded. The answers go to the sheet (see trip.ts). ?loader=snow|duel|guess picks the card shown first.
import { esc, euro } from "./ui/render.ts";
import { haptic } from "./ui/haptic.ts";

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
// The answers must match QUIZ in sheet/Code.gs, which drops anything else.
const QUESTIONS: { q: string; a: [string, string] }[] = [
  { q: "Ski or snowboard?", a: ["⛷️ Ski", "🏂 Board"] },
  { q: "First lift or lie-in?", a: ["🌅 First lift", "😴 Lie-in"] },
  { q: "Après-ski or early night?", a: ["🍻 Après", "🛌 Early night"] },
  { q: "Fondue or pizza on the slopes?", a: ["🫕 Fondue", "🍕 Pizza"] },
];
const verdict = (g: number, r: number) => {
  const pct = Math.abs(g - r) / r;
  return pct <= 0.05 ? "🏆 Spot on!" : pct <= 0.15 ? "👏 So close!" : pct <= 0.3 ? "Not bad." : "Ouch, a bit more than you hoped.";
};
const flakes = Array.from({ length: 18 }, (_, i) =>
  `<i style="left:${(i * 53) % 100}%;animation-delay:${((i * 37) % 30) / 10}s;animation-duration:${3 + ((i * 17) % 30) / 10}s;font-size:${10 + ((i * 7) % 12)}px">❄</i>`).join("");
const CONFETTI = ["#3d7bff", "#8a5cff", "#22c55e", "#ffd257", "#ff5c8a", "#3ee6ff"];

export interface LoaderOpts {
  /** First visit: the trip stays hidden until both games are done. */
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
  /** Called once both games are done, with what to save. */
  onDone: (answers: string[], guess: number) => void;
}
export interface LoaderHandle {
  /** The trip has loaded; `skipGate` opens it without the games (the organiser, or someone who already played). */
  ready(realPP: number | null, skipGate?: boolean): void;
  stop(): void;
}

/** Shows the slider in `el`. Call ready() when the trip has loaded and stop() if it fails. */
export function startLoader(el: HTMLElement, o: LoaderOpts): LoaderHandle {
  const answers: string[] = [];
  let gate = o.gate;
  let guess = 1200, locked = false, loaded = false, real: number | null = null, revealed = false, saved = false;
  const games = o.intro ? `<span class="ld-gate">${esc(o.intro)}</span>` : o.gate ? `<span class="ld-gate">2 quick games before your trip opens →</span>` : `<span class="foot">Swipe for a quick game →</span>`;
  el.innerHTML = `<div class="ld" role="status" aria-label="Loading the trip">` +
    `<div class="ld-slider">` +
    `<section class="ld-pane ld-snow"><div class="ld-flakes" aria-hidden="true">${flakes}</div><b>${esc(o.title || "❄️ Opening your trip")}</b><span class="ld-line">${LINES[0]}</span>${games}</section>` +
    `<section class="ld-pane ld-duel"><div class="ld-card"></div></section>` +
    `<section class="ld-pane ld-guess"><div class="ld-card"></div></section></div>` +
    `<div class="ld-dots">${ORDER.map((k, i) => `<button type="button" data-go="${i}" aria-label="Show ${k}"></button>`).join("")}</div>` +
    `<div class="ld-bar" aria-hidden="true"><span></span></div><div class="ld-foot"></div></div>`;
  const slider = el.querySelector<HTMLElement>(".ld-slider")!, dots = [...el.querySelectorAll<HTMLElement>(".ld-dots button")];
  const duel = el.querySelector<HTMLElement>(".ld-duel .ld-card")!, guessCard = el.querySelector<HTMLElement>(".ld-guess .ld-card")!;
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
      : `<span class="ld-check" aria-hidden="true">✓</span><b>${answers.join(" · ")}</b><span class="foot">${locked ? "All done" : "Now guess the price →"}</span>`;
  };
  const drawGuess = () => {
    guessCard.innerHTML = `<b>🎯 Guess the price</b><span class="ld-q">Per person, all in: flight, house, lift pass, rental and food</span>` +
      `<output class="ld-val">${euro(guess)}</output>` +
      `<input type="range" min="500" max="3000" step="50" value="${guess}" aria-label="Your guess, euros per person">` +
      `<button type="button" class="ld-lock" data-act="lock-guess">Lock my guess</button>`;
    const r = guessCard.querySelector<HTMLInputElement>("input")!, out = guessCard.querySelector("output")!;
    r.oninput = () => { guess = +r.value; out.textContent = euro(guess); };
  };
  // The price reveal: the number runs from the guess to the real price; cheaper than guessed is a win.
  const revealGuess = () => {
    if (!locked || real == null) return;
    const r = real, cheaper = r < guess;
    guessCard.innerHTML = `<span class="foot">You said ${euro(guess)}</span><output class="ld-val ld-count">${euro(guess)}</output>` +
      `<b class="ld-verdict">${cheaper ? `🎉 Congratulations! It's ${euro(guess - r)} less than you thought` : verdict(guess, r)}</b>` +
      `<span class="foot">per person, all in, for the top pick</span>`;
    const out = guessCard.querySelector<HTMLElement>(".ld-count")!, t0 = performance.now(), d = 1200;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / d), e = 1 - Math.pow(1 - k, 3);
      out.textContent = euro(guess + (r - guess) * e);
      if (k < 1) requestAnimationFrame(step); else out.classList.add(cheaper ? "win" : "done");
    };
    requestAnimationFrame(step);
    if (cheaper) { confetti(guessCard); haptic([30, 50, 30, 50, 60]); }
  };
  const tryOpen = () => {
    const done = answers.length === QUESTIONS.length && locked;
    if (done && !saved) { saved = true; o.onDone(answers.slice(), guess); }
    if (revealed) return;
    // Games done before the sheet has answered: say it's still on its way, not stuck.
    if (!loaded) { if (done) foot.innerHTML = `<span class="ld-gate">⏳ All done, almost there: still saving…</span>`; return; }
    if (gate && !done) {
      foot.innerHTML = `<span class="ld-gate">${esc(o.gateLine || `🔓 Your trip is ready: ${answers.length < QUESTIONS.length ? "answer the questions" : "lock your guess"} to open it`)}</span>`;
      go(answers.length < QUESTIONS.length ? 1 : 2);
      return;
    }
    revealed = true;
    el.querySelector(".ld")!.classList.add("ready");
    foot.innerHTML = `<button type="button" class="ld-nudge" data-act="to-trip">${esc(o.doneLine || "✅ Your trip is ready ↓")}</button>`;
    o.onReveal(loaderResult(answers, locked ? guess : null, real));
    setTimeout(() => glide(o.target), locked && real != null && real < guess ? 1800 : 900);
  };

  drawDuel(); drawGuess();
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
          if (answers.length === QUESTIONS.length) { setTimeout(() => go(2), 700); tryOpen(); }
        }, 220);
      }, 420);
    }
    if (t.closest("[data-act='lock-guess']") && !locked) {
      locked = true; haptic([15, 40, 15]);
      const b = guessCard.querySelector<HTMLElement>(".ld-lock")!;
      b.classList.add("locked"); b.textContent = `✓ ${euro(guess)} locked`;
      guessCard.querySelector("input")!.disabled = true;
      setTimeout(() => {
        if (real != null) revealGuess();
        else guessCard.insertAdjacentHTML("beforeend", `<span class="foot">Let's see how close you are…</span>`);
        if (answers.length < QUESTIONS.length) setTimeout(() => go(1), 600);
        tryOpen();
      }, 500);
    }
  };
  return {
    ready(realPP, skipGate) { loaded = true; real = realPP; if (skipGate) gate = false; revealGuess(); tryOpen(); },
    stop() { clearInterval(timer); el.onclick = null; el.innerHTML = ""; },
  };
}

function confetti(host: HTMLElement) {
  const box = document.createElement("div");
  box.className = "ld-confetti"; box.setAttribute("aria-hidden", "true");
  box.innerHTML = Array.from({ length: 28 }, (_, i) => {
    const ang = (i / 28) * Math.PI * 2, dist = 70 + (i * 37) % 70;
    return `<i style="--x:${Math.round(Math.cos(ang) * dist)}px;--y:${Math.round(Math.sin(ang) * dist - 40)}px;background:${CONFETTI[i % CONFETTI.length]};animation-delay:${(i % 5) * 20}ms"></i>`;
  }).join("");
  host.appendChild(box);
  setTimeout(() => box.remove(), 1800);
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

/** Lines for the top of the trip once it opens: how close the guess was, and the quick answers. */
/** Lines for the card: how close a guess was, and the quick answers. `who` names someone else (the organiser);
 *  without it the lines are about the visitor ("You guessed", "Your ski style"). */
export function loaderResult(answers: string[], guess: number | null, real: number | null, who = ""): string {
  const guessed = who ? `${esc(who)} guessed` : "You guessed", style = who ? `${esc(who)}'s ski style` : "Your ski style";
  let out = "";
  if (guess != null && real) out += real < guess
    ? `<p class="ld-result win">🎉 ${guessed} <b>${euro(guess)}</b> and the top pick is only <b>${euro(real)}</b> per person: ${euro(guess - real)} less. Lock it in before it goes!</p>`
    : `<p class="ld-result">🎯 ${guessed} <b>${euro(guess)}</b>, the top pick is <b>${euro(real)}</b> per person: ${verdict(guess, real)}</p>`;
  if (answers.length) out += `<p class="ld-result">⛷️ ${style}: ${answers.join(" · ")}</p>`;
  return out;
}
