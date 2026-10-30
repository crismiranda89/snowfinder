// The promo image for Instagram and the group chats, drawn on the fly from a pick: the house photo, split
// diagonally with the resort (a drawn mountain, its name and altitude), and the trip's details on a card
// over the photo. 1080 × 1350 (Instagram's 4:5). Shown in a preview first: phones only open the share sheet
// straight after a tap, and the photo takes a moment to load.
import { esc, euro, hm, sourceName, type PickSummary } from "./render.ts";
import { SEASON } from "../data.ts";

const W = 1080, H = 1350;
const DISPLAY = '"Barlow Condensed", "Arial Narrow", sans-serif', BODY = 'Figtree, system-ui, sans-serif';

/** The house photo, if its host lets the page draw it (Booking and Airbnb do); else null and a snowy backdrop. */
async function photo(url: string | null): Promise<ImageBitmap | null> {
  if (!url || !/^https:\/\//.test(url)) return null;
  try {
    // A slow photo host: after 10 s the image goes ahead with the drawn mountains instead
    const signal = "timeout" in AbortSignal ? AbortSignal.timeout(10000) : undefined;
    const r = await fetch(url, { mode: "cors", referrerPolicy: "no-referrer", signal });
    return r.ok ? await createImageBitmap(await r.blob()) : null;
  } catch { return null; }
}

/** Lines of `text` that fit `max` px wide, at most `n` of them (the last one cut with "…"). */
function wrap(c: CanvasRenderingContext2D, text: string, max: number, n: number): string[] {
  const out: string[] = []; let line = "";
  for (const w of text.split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (c.measureText(t).width <= max || !line) line = t; else { out.push(line); line = w; }
  }
  if (line) out.push(line);
  if (out.length > n) { out.length = n; let l = out[n - 1]; while (l && c.measureText(l + "…").width > max) l = l.slice(0, -1); out[n - 1] = l.trimEnd() + "…"; }
  return out;
}

export interface PromoText { /** "👋 Cris picked this", "🤖 AI pick" or "Our ski trip". */ who: string }

export async function promoImage(p: PickSummary, o: PromoText): Promise<Blob> {
  await Promise.all([`700 96px ${DISPLAY}`, `600 30px ${BODY}`, `400 30px ${BODY}`].map((f) => document.fonts.load(f).catch(() => null)));
  const img = await photo(p.listing.photo);
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const c = cv.getContext("2d")!;

  // The house photo, covering the whole image (the resort and the card go over it)
  if (img) {
    const k = Math.max(W / img.width, H / img.height), w = img.width * k, h = img.height * k;
    c.drawImage(img, (W - w) / 2, (H - h) / 2.6, w, h);
  } else {
    // No photo we may draw: a big snowy range instead
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#5b7fd6"); g.addColorStop(0.6, "#b9c8ff"); g.addColorStop(1, "#eef3ff");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    for (const [x, hgt, col] of [[180, 620, "#2c3c86"], [620, 760, "#24306e"], [980, 560, "#34489c"]] as [number, number, string][]) {
      const base = H - 220, top = base - hgt;
      c.fillStyle = col; c.beginPath(); c.moveTo(x - hgt * 0.9, base); c.lineTo(x, top); c.lineTo(x + hgt * 0.9, base); c.fill();
      c.fillStyle = "#f4f7ff"; c.beginPath(); c.moveTo(x - hgt * 0.3, top + hgt * 0.33); c.lineTo(x, top); c.lineTo(x + hgt * 0.3, top + hgt * 0.33);
      c.lineTo(x + hgt * 0.12, top + hgt * 0.26); c.lineTo(x, top + hgt * 0.36); c.lineTo(x - hgt * 0.12, top + hgt * 0.26); c.fill();
    }
    c.fillStyle = "#eef3ff"; c.fillRect(0, H - 220, W, 220);
  }
  const shade = c.createLinearGradient(0, H * 0.45, 0, H); shade.addColorStop(0, "rgba(8,12,20,0)"); shade.addColorStop(1, "rgba(8,12,20,.75)");
  c.fillStyle = shade; c.fillRect(0, 0, W, H);

  // The resort: a diagonal slab top left, night sky, snowy peaks and falling snow
  const tx = 880, ty = 660;
  c.save(); c.beginPath(); c.moveTo(0, 0); c.lineTo(tx, 0); c.lineTo(0, ty); c.closePath(); c.clip();
  const sky = c.createLinearGradient(0, 0, tx * 0.6, ty); sky.addColorStop(0, "#1b2b6b"); sky.addColorStop(0.55, "#3d4fc0"); sky.addColorStop(1, "#8a5cff");
  c.fillStyle = sky; c.fillRect(0, 0, tx, ty);
  // Peaks along the bottom of the slab, where it's widest (the back ones darker)
  const peaks: [number, number, number, string][] = [[160, ty, 300, "#b9c8ff"], [-120, ty, 360, "#e9efff"], [40, ty + 40, 250, "#d6e0ff"]];
  for (const [x, base, hgt, snow] of peaks) {
    const top = base - hgt, half = hgt * 0.95;
    c.fillStyle = "#24306e"; c.beginPath(); c.moveTo(x, base); c.lineTo(x + half, top); c.lineTo(x + 2 * half, base); c.fill();
    c.fillStyle = snow; c.beginPath(); c.moveTo(x + half * 0.62, top + hgt * 0.38); c.lineTo(x + half, top); c.lineTo(x + half * 1.38, top + hgt * 0.38);
    c.lineTo(x + half * 1.18, top + hgt * 0.3); c.lineTo(x + half, top + hgt * 0.42); c.lineTo(x + half * 0.82, top + hgt * 0.3); c.fill();
  }
  c.fillStyle = "rgba(255,255,255,.85)";
  for (let i = 0; i < 70; i++) {
    const x = (i * 157) % tx, y = (i * 263) % ty, r = 2 + ((i * 7) % 5);
    if (y > 30 && y < 270 && x < 640) continue; // not over the resort's name
    c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
  }
  c.restore();
  // A bright edge along the split
  c.strokeStyle = "#ffffff"; c.lineWidth = 8; c.beginPath(); c.moveTo(tx + 4, -4); c.lineTo(-4, ty + 4); c.stroke();

  // Resort name and where it is, inside the slab (the slab narrows going down)
  c.fillStyle = "#fff"; c.textBaseline = "alphabetic";
  c.font = `600 26px ${BODY}`; c.fillText("❄  SNOWFINDER", 56, 76);
  let size = 112; c.font = `700 ${size}px ${DISPLAY}`;
  const room = (y: number) => tx * (1 - y / ty) - 90;
  while (size > 56 && c.measureText(p.resort.name.toUpperCase()).width > room(190)) { size -= 4; c.font = `700 ${size}px ${DISPLAY}`; }
  c.fillText(p.resort.name.toUpperCase(), 52, 190);
  c.font = `600 30px ${BODY}`; c.fillStyle = "rgba(255,255,255,.88)";
  c.fillText(wrap(c, `${p.resort.region || p.resort.country} · ${p.resort.altitude}`, room(240), 1)[0], 56, 240);

  // The guests' score, top right over the photo: "★ 9.4 /10" and where it's from
  if (p.listing.rating != null) {
    const score = p.listing.rating.toFixed(1), from = sourceName(p.listing);
    c.font = `700 64px ${DISPLAY}`; const sw = c.measureText(`★ ${score}`).width;
    c.font = `600 26px ${BODY}`; const ow = c.measureText("/10").width, fw = c.measureText(from).width;
    const bw = Math.max(sw + 10 + ow, fw) + 56, bh = 128, bx = W - 44 - bw, by = 44;
    c.save(); c.shadowColor = "rgba(0,0,0,.35)"; c.shadowBlur = 24; c.shadowOffsetY = 6;
    c.fillStyle = "#ffffff"; c.beginPath(); c.roundRect(bx, by, bw, bh, 28); c.fill(); c.restore();
    c.font = `700 64px ${DISPLAY}`; c.fillStyle = "#f5a623"; c.fillText("★", bx + 28, by + 70);
    const star = c.measureText("★ ").width;
    c.fillStyle = "#0e1621"; c.fillText(score, bx + 28 + star, by + 70);
    c.font = `600 26px ${BODY}`; c.fillStyle = "#5a6a7a"; c.fillText("/10", bx + 28 + sw + 10, by + 70);
    c.font = `600 22px ${BODY}`; c.fillText(from, bx + 28, by + 104);
  }

  // The card over the photo: who picked it, the house, dates and group, flight, and the price
  const X = 48, CW = W - 2 * X, P = 48, inner = CW - 2 * P;
  c.font = `700 62px ${DISPLAY}`; const title = wrap(c, p.listing.title, inner, 2);
  const t = SEASON.flightTimes[p.option.code];
  const lines = [
    `🚶 ${p.walk} · ${p.listing.bedrooms} bedrooms`,
    `📅 ${p.when} · ${p.people} people`,
    `✈️ ${SEASON.origin.city} → ${p.option.air}${t ? ` · ${hm(t.mins + p.option.mins)} door to door` : ""}`,
  ];
  const ch = P + 34 + 18 + title.length * 64 + 16 + lines.length * 46 + 26 + 118 + 20 + 34 + P;
  const Y = H - X - ch;
  c.save();
  c.shadowColor = "rgba(0,0,0,.45)"; c.shadowBlur = 40; c.shadowOffsetY = 12;
  c.fillStyle = "rgba(12,18,32,.9)"; c.beginPath(); c.roundRect(X, Y, CW, ch, 36); c.fill();
  c.restore();
  c.strokeStyle = "rgba(140,170,255,.35)"; c.lineWidth = 2; c.beginPath(); c.roundRect(X, Y, CW, ch, 36); c.stroke();

  let y = Y + P + 28;
  c.font = `600 28px ${BODY}`; c.fillStyle = "#8fb4ff"; c.fillText(o.who.toUpperCase(), X + P, y);
  y += 18;
  c.font = `700 62px ${DISPLAY}`; c.fillStyle = "#fff";
  for (const l of title) { y += 64; c.fillText(l, X + P, y - 8); }
  y += 16;
  c.font = `400 30px ${BODY}`; c.fillStyle = "#c3cede";
  for (const l of lines) { y += 46; c.fillText(wrap(c, l, inner, 1)[0], X + P, y); }
  y += 26 + 104;
  const price = euro(p.pp), grad = c.createLinearGradient(X + P, 0, X + P + 420, 0);
  grad.addColorStop(0, "#6ea2ff"); grad.addColorStop(1, "#c08cff");
  c.font = `700 128px ${DISPLAY}`; c.fillStyle = grad; c.fillText(price, X + P - 4, y);
  const pw = c.measureText(price).width;
  c.font = `600 30px ${BODY}`; c.fillStyle = "#fff"; c.fillText("per person", X + P + pw + 18, y - 52);
  c.font = `400 28px ${BODY}`; c.fillStyle = "#c3cede"; c.fillText("all in", X + P + pw + 18, y - 14);
  y += 14 + 34;
  c.font = `400 24px ${BODY}`; c.fillStyle = "#93a3b4";
  c.fillText(wrap(c, "Flight, house, lift pass, rental and food · vote on Snowfinder", inner, 1)[0], X + P, y);

  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("no image"))), "image/png"));
}

/** The preview: the image with Share (phones), Save image and Copy link. */
export async function openPromo(p: PickSummary, o: PromoText & { link: string; toast: (m: string) => void }) {
  let d = document.getElementById("promodlg") as HTMLDialogElement | null;
  if (!d) {
    document.body.insertAdjacentHTML("beforeend", `<dialog id="promodlg" class="askdlg promodlg"><div class="promo-img" aria-live="polite"></div>` +
      `<div class="ask-acts"><button type="button" class="ghost" data-pr="close">Close</button><button type="button" class="btn secondary" data-pr="copy">Copy link</button>` +
      `<button type="button" class="btn secondary" data-pr="save">Save image</button><button type="button" class="btn" data-pr="share">Share</button></div></dialog>`);
    d = document.getElementById("promodlg") as HTMLDialogElement;
  }
  const box = d.querySelector<HTMLElement>(".promo-img")!;
  box.innerHTML = `<span class="foot">Making your image…</span>`;
  d.showModal();
  let blob: Blob;
  try { blob = await promoImage(p, o); } catch { box.innerHTML = `<span class="foot">Couldn't make the image on this phone.</span>`; return; }
  const name = `snowfinder-${p.resort.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
  const file = new File([blob], name, { type: "image/png" }), url = URL.createObjectURL(blob);
  const text = `⛷️ ${p.resort.name}, ${p.when}: ${euro(p.pp)} per person, all in. Vote here: ${o.link}`;
  box.innerHTML = `<img src="${url}" alt="${esc(`${p.listing.title}, ${p.resort.name}: ${euro(p.pp)} per person`)}">`;
  const canShare = !!navigator.canShare?.({ files: [file] });
  d.querySelector<HTMLElement>("[data-pr='share']")!.hidden = !canShare;
  d.onclick = async (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>("[data-pr]")?.dataset.pr;
    if (b === "close" || ev.target === d) d!.close();
    else if (b === "save") { const a = document.createElement("a"); a.href = url; a.download = name; a.click(); }
    else if (b === "copy") navigator.clipboard.writeText(text).then(() => o.toast("Link copied: paste it with the image."), () => window.prompt("Copy this:", text));
    // Instagram takes the image only; the text (with the link) goes to apps that take both
    else if (b === "share") navigator.share({ files: [file], text }).catch(() => { /* closed the share sheet */ });
  };
  d.onclose = () => URL.revokeObjectURL(url);
}
