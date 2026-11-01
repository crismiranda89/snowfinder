// Snowfinder vibe checker (vibe.html): for the people who don't ski. Swipe photos of spas, sleigh rides, huskies
// and snowy villages (right = love it, left = not for me, ★ = must have); after ROUNDS cards it names the resort
// that fits best. Each card says how much it speaks for each resort (data/vibe.json, `w`); the match is the share
// of a resort's weight in the cards you saw that you liked, so resorts with more cards don't win by default.
import vibeJson from "../data/vibe.json" with { type: "json" };
import resortsJson from "../data/resorts.json" with { type: "json" };
import { haptic } from "./ui/haptic.ts";

interface Card { id: string; title: string; sub: string; kids: boolean; img: string; page: string; credit: string; license: string; w: Record<string, number> }
type Vote = "love" | "nope" | "star";

const CARDS = (vibeJson as unknown as { cards: Card[] }).cards;
const RESORTS = Object.fromEntries((resortsJson as unknown as { resorts: { id: string; name: string; country: string }[] }).resorts.map((r) => [r.id, r]));
const ROUNDS = 12;
const app = document.getElementById("app")!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

let deck: Card[] = [];
let votes: { c: Card; v: Vote }[] = [];

/** A deck that opens with kids in the snow, then the rest shuffled; every resort gets at least two cards. */
function newDeck(): Card[] {
  const kids = CARDS.filter((c) => c.kids), rest = CARDS.filter((c) => !c.kids);
  const shuffle = <T,>(xs: T[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const first = shuffle(kids)[0];
  const picked = [first, ...shuffle([...rest, ...kids.filter((c) => c !== first)]).slice(0, ROUNDS - 1)];
  const count = (id: string, xs = picked) => xs.filter((c) => c.w[id]).length;
  // Top up any resort with under two cards: swap out a later card no other resort needs to stay at two.
  for (const id of Object.keys(RESORTS)) {
    while (count(id) < 2) {
      const add = shuffle(CARDS.filter((x) => x.w[id] && !picked.includes(x)))[0];
      let drop = -1;
      for (let i = picked.length - 1; i > 0 && drop < 0; i--) if (!picked[i].w[id] && Object.keys(picked[i].w).every((r) => count(r) > 2)) drop = i;
      if (!add || drop < 0) break;
      picked.splice(drop, 1);
      picked.splice(1 + Math.floor(Math.random() * (picked.length - 1)), 0, add);
    }
  }
  return picked;
}

function intro() {
  const peek = [CARDS.find((c) => c.id === "caldea"), CARDS.find((c) => c.kids), CARDS.find((c) => c.id === "huskies")].filter(Boolean) as Card[];
  app.innerHTML = `<section class="intro">
    <div class="peek">${peek.map((c) => `<img src="${esc(c.img)}" alt="">`).join("")}</div>
    <h1>Snowfinder <em>vibe checker</em></h1>
    <p>Not a skier? Perfect. Swipe the snow days you'd love, from spas and sleigh rides to huskies and cheese, and we'll tell you where to go.</p>
    <div class="how"><span>👈 not for me</span><span>love it 👉</span><span>⭐ must have</span></div>
    <button class="btn" data-act="start">Start swiping ✨</button>
    <p style="font-size:.85rem">${ROUNDS} photos, about a minute.</p></section>`;
}

function render() {
  const i = votes.length;
  if (i >= deck.length) return result();
  const c = deck[i], next = deck[i + 1];
  app.innerHTML = `<div class="top"><b>Vibe checker</b><small>${i + 1} / ${deck.length}</small></div>
    <div class="bar"><i style="width:${(i / deck.length) * 100}%"></i></div>
    <div class="deck">${next ? cardHtml(next, true) : ""}${cardHtml(c, false)}</div>
    <div class="acts"><button class="round" data-vote="nope" aria-label="Not for me">✖️</button><button class="round small" data-vote="star" aria-label="Must have">⭐</button><button class="round" data-vote="love" aria-label="Love it">❤️</button></div>`;
  if (deck[i + 2]) new Image().src = deck[i + 2].img;
  drag(app.querySelector<HTMLElement>(".card:not(.behind)")!);
}

function cardHtml(c: Card, behind: boolean) {
  return `<div class="card${behind ? " behind" : ""}"><img src="${esc(c.img)}" alt="${esc(c.title)}" draggable="false">
    ${c.kids ? `<span class="kid">👧 Kids love this</span>` : ""}<span class="cred">📷 ${esc(c.credit)}</span>
    <span class="stamp yes">LOVE</span><span class="stamp no">NOPE</span>
    <div class="shade"><h2>${esc(c.title)}</h2><div class="sub">${esc(c.sub)}</div></div></div>`;
}

/** Drag the top card; past 90 px it flies off that way. */
function drag(el: HTMLElement) {
  let x0 = 0, y0 = 0, dx = 0, dy = 0, on = false;
  const yes = el.querySelector<HTMLElement>(".stamp.yes")!, no = el.querySelector<HTMLElement>(".stamp.no")!;
  const move = () => { el.style.transform = `translate(${dx}px,${dy}px) rotate(${dx / 14}deg)`; yes.style.opacity = String(Math.max(0, dx / 90)); no.style.opacity = String(Math.max(0, -dx / 90)); };
  el.addEventListener("pointerdown", (e) => { on = true; x0 = e.clientX; y0 = e.clientY; el.setPointerCapture(e.pointerId); el.style.transition = "none"; });
  el.addEventListener("pointermove", (e) => { if (!on) return; dx = e.clientX - x0; dy = (e.clientY - y0) * 0.4; move(); });
  const up = () => {
    if (!on) return; on = false;
    if (Math.abs(dx) > 90) return vote(dx > 0 ? "love" : "nope");
    el.style.transition = "transform .25s"; dx = dy = 0; move();
  };
  el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
}

function vote(v: Vote) {
  const el = app.querySelector<HTMLElement>(".card:not(.behind)");
  if (!el || el.dataset.gone) return;
  el.dataset.gone = "1";
  haptic(v === "nope" ? 8 : [10, 40, 10]);
  votes.push({ c: deck[votes.length], v });
  const out = v === "nope" ? -1 : 1;
  el.style.transition = "transform .32s ease-in, opacity .32s";
  el.style.transform = v === "star" ? "translateY(-120%) scale(.9)" : `translate(${out * 130}%,-4%) rotate(${out * 22}deg)`;
  el.style.opacity = "0";
  const stamp = el.querySelector<HTMLElement>(v === "nope" ? ".stamp.no" : ".stamp.yes"); if (stamp) stamp.style.opacity = "1";
  setTimeout(render, 280);
}

/** Per resort: liked weight ÷ weight shown (★ counts double), with a little smoothing for resorts barely seen. */
function scores() {
  return Object.keys(RESORTS).map((id) => {
    let shown = 0, liked = 0;
    for (const { c, v } of votes) { const w = c.w[id] || 0; shown += w; if (v !== "nope") liked += w * (v === "star" ? 2 : 1); }
    return { id, pct: Math.round(Math.min(1, (liked + 0.5) / (shown + 2)) * 100), loved: votes.filter(({ c, v }) => v !== "nope" && c.w[id]).sort((a, b) => (b.v === "star" ? 1 : 0) - (a.v === "star" ? 1 : 0) || (b.c.w[id] - a.c.w[id])) };
  }).sort((a, b) => b.pct - a.pct || b.loved.length - a.loved.length);
}

function result() {
  const s = scores(), top = s[0], r = RESORTS[top.id];
  const liked = votes.filter((x) => x.v !== "nope").length;
  // The photo is the place itself: a card that's most about this resort, the one you liked if any.
  const hero = top.loved.find((x) => x.c.w[top.id] >= 3)?.c || CARDS.find((c) => c.w[top.id] >= 3) || top.loved[0]?.c || CARDS[0];
  const link = new URL("vibe.html", location.href).href;
  const msg = `✨ I did the Snowfinder vibe check and my snow trip is ${r.name} (${top.pct}% match)!` +
    (top.loved.length ? ` I'm in for: ${top.loved.slice(0, 3).map((x) => x.c.title.toLowerCase()).join(", ")}.` : "") + ` Your turn 👉 ${link}`;
  app.innerHTML = `<section class="result">
    <div class="hero"><img src="${esc(hero.img)}" alt=""><div class="shade"><div class="eyebrow">Your snow vibe is</div><h1>${esc(r.name)}</h1><div class="match">${top.pct}% match · ${esc(r.country)}</div></div></div>
    ${liked ? `<div class="why"><b>Because you loved</b><ul>${top.loved.slice(0, 4).map((x) => `<li>${x.v === "star" ? "⭐ " : ""}${esc(x.c.title)}</li>`).join("")}</ul></div>`
      : `<p class="empty">Nothing caught your eye? Fair. ${esc(r.name)} is the best guess; try again with a few more hearts.</p>`}
    <div class="others">${s.slice(1, 4).map((x) => `<div class="other"><span>${esc(RESORTS[x.id].name)}</span><span class="m"><i style="width:${x.pct}%"></i></span><b>${x.pct}%</b></div>`).join("")}</div>
    <div class="stack">
      <a class="btn" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Send to the group on WhatsApp</a>
      <a class="btn ghost" href="./">See the trip plan (prices, houses)</a>
      <button class="btn ghost" data-act="again">Swipe again</button>
    </div>
    <p class="credits">Photos from Wikimedia Commons: ${votes.map(({ c }) => `<a href="${esc(c.page)}" target="_blank" rel="noopener">${esc(c.credit)}</a> (${esc(c.license)})`).join(" · ")}.</p></section>`;
  haptic([15, 60, 15, 60, 30]);
}

function start() { deck = newDeck(); votes = []; render(); }

app.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const v = t.closest<HTMLElement>("[data-vote]"); if (v) vote(v.dataset.vote as Vote);
  const a = t.closest<HTMLElement>("[data-act]")?.dataset.act;
  if (a === "start" || a === "again") start();
});
document.addEventListener("keydown", (e) => {
  if (!app.querySelector(".deck")) return;
  if (e.key === "ArrowRight") vote("love"); else if (e.key === "ArrowLeft") vote("nope"); else if (e.key === "ArrowUp") vote("star");
});
intro();
