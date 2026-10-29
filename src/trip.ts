// Shared trips: one organiser creates a trip from their pick, friends open the link, vote, add their own
// pick or post "I have a better option" (text, links, screenshots) for review. Stored in a Google Sheet
// through a small Apps Script web app (sheet/Code.gs); its URL comes from <meta name="snowfinder-api">.
import { GROUPS, decodeShare, encodeShare, groupId, type State } from "./state.ts";
import { RESORTS_FILE, SEASON } from "./data.ts";
import { nights } from "./model/calendar.ts";
import { esc, euro, fittingHouses, pickSummary, resetCache, type PickSummary } from "./ui/render.ts";

const $ = (id: string) => document.getElementById(id)!;
const API = (document.querySelector('meta[name="snowfinder-api"]') as HTMLMetaElement | null)?.content || "";
export const tripsReady = () => /^https:\/\/|^http:\/\/localhost[:/]/.test(API); // localhost: a local stand-in for tests
export const tripId = () => new URLSearchParams(location.search).get("trip") || "";

/** What a pick stores: enough to show its card and to reopen the exact plan. */
export interface PickData {
  listingId: string; title: string; url: string; photo: string | null; resort: string; airport: string;
  when: string; people: number; pp: number; group: number; houseTotal: number; walk: string;
  bedrooms: number; sleeps: number; share: string; foundBy?: string;
}
interface Pick { id: string; name: string; reason: string; created: string; data: PickData; status?: string; checked?: string; note?: string }
interface Idea { id: string; name: string; text: string; links: string[]; images: string[]; status: string; reply: string; created: string; checked?: string }

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
/** The checker's verdict on a pick: is it still bookable for these dates at this price? */
function pickStatus(p: Pick) {
  const at = when(p.checked), note = p.note ? ` ${esc(p.note)}` : "";
  if (p.status === "available") return `<p class="pstat ok">✓ Still available${at ? ` · checked ${at}` : ""}${note ? ` ·${note}` : ""}</p>`;
  if (p.status === "unavailable") return `<p class="pstat bad">✕ No longer available for these dates${at ? ` · checked ${at}` : ""}.${note}</p>`;
  if (p.status === "changed") return `<p class="pstat warn">Price changed${at ? ` · checked ${at}` : ""}.${note}</p>`;
  return `<p class="pstat">Availability not checked yet · first check within 30 min</p>`;
}
interface TripView { trip: { id: string; organizer: string; title: string }; picks: Pick[]; votes: { name: string; pick: string }[]; ideas: Idea[] }

const NAME_KEY = "snowfinder-name";
const myName = () => { try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; } };
const setName = (n: string) => { try { localStorage.setItem(NAME_KEY, n); } catch { /* private mode */ } };

async function get(id: string): Promise<TripView> {
  const r = await fetch(`${API}?trip=${encodeURIComponent(id)}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}
async function post(body: object): Promise<any> {
  // text/plain keeps this a "simple" request, so Apps Script needs no CORS preflight
  const r = await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
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
  const group = s ? GROUPS.find((g) => g.id === groupId(s.group))!.label : `${d.people} people`;
  // Prices are cached per render for the viewer's own settings: count with the pick's settings, then clear.
  resetCache();
  const looked = s ? fittingHouses(s).length : 0;
  resetCache();
  const n = s ? nights(SEASON, s.days) : 5;
  const country = RESORTS_FILE.resorts.find((r) => r.name === d.resort)?.country || "";
  return [
    `⛷️ *Ski trip – let's decide!*`,
    ``,
    looked > 1 ? `I compared ${looked} places for ${group.toLowerCase()}. My pick:` : `My pick for ${group.toLowerCase()}:`,
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
    `⏳ Places go fast: availability is re-checked every 2 hours.`,
  ].join("\n");
}

// ---- the "Your pick" bar, shown once a house is chosen
export function renderMyPick(s: State) {
  const box = $("mypick"), p = pickSummary(s);
  if (!p) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  const inTrip = !!tripId();
  box.innerHTML = `<div class="mp-photo">${p.listing.photo ? `<img src="${esc(p.listing.photo)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : ""}</div>` +
    `<div class="mp-body"><span class="eyebrow">Your pick</span><b>${esc(p.listing.title)}</b>` +
    `<small>${esc(p.resort.name)} · ${esc(p.walk)} · ${esc(p.when)}</small>` +
    `<div class="mp-price"><b>${euro(p.pp)}</b><small>per person all in · ${euro(p.group)} group</small></div></div>` +
    `<div class="mp-acts">${tripsReady()
      ? `<button type="button" class="btn" data-act="${inTrip ? "add-pick" : "create-trip"}">${inTrip ? "Add my pick to the trip" : "Create our trip"}</button>`
      : `<span class="foot">Shared trips aren't set up on this site yet.</span>`}` +
    `<button type="button" class="ghost" data-act="clear-pick">Clear</button></div>`;
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
  try {
    const { trip } = await post({ action: "createTrip", name: a.name, title: `${GROUPS.find((g) => g.id === groupId(s.group))!.label} · ${p.when}`, reason: a.reason, data: pickData(s, p) });
    history.pushState(null, "", `?trip=${trip}`);
    await loadTrip(s, toast);
    toast("Trip created. Copy the message below and paste it in your group chats.");
    document.getElementById("tmsg-text")?.scrollIntoView({ block: "center", behavior: "smooth" });
  } catch (e) { toast(`Couldn't create the trip: ${(e as Error).message}`); }
}
export async function addPick(s: State, toast: (m: string) => void) {
  const p = pickSummary(s); if (!p) return;
  const a = await ask("Add my pick", autoReason(p)); if (!a) return;
  try { await post({ action: "addPick", trip: tripId(), name: a.name, reason: a.reason, data: pickData(s, p) }); toast("Your pick is in, with your vote."); await loadTrip(s, toast); }
  catch (e) { toast(`Couldn't add your pick: ${(e as Error).message}`); }
}
async function vote(pick: string, s: State, toast: (m: string) => void) {
  let name = myName();
  if (!name) { const a = await ask("Your name, to vote", null); if (!a) return; name = a.name; }
  try { await post({ action: "vote", trip: tripId(), name, pick }); await loadTrip(s, toast); }
  catch (e) { toast(`Couldn't vote: ${(e as Error).message}`); }
}

// ---- the trip panel at the top
let last: TripView | null = null;
export async function loadTrip(s: State, toast: (m: string) => void) {
  const id = tripId(), box = $("trip-block");
  if (!id) { box.hidden = true; return; }
  box.hidden = false;
  if (!tripsReady()) { $("trip-body").innerHTML = `<p class="foot">This trip link needs the shared-trip sheet, which isn't set up on this copy of the site.</p>`; return; }
  if (!last) $("trip-body").innerHTML = `<p class="foot">Loading the trip…</p>`;
  try { last = await get(id); renderTrip(s); }
  catch (e) { $("trip-body").innerHTML = `<p class="foot">Couldn't load this trip: ${esc((e as Error).message)}.</p>`; }
}

function pickCard(p: Pick, votes: string[], mine: string, flag: string) {
  const d = p.data;
  return `<article class="tpick${flag ? " pinned" : ""}">` +
    (flag ? `<div class="tflag">${flag}</div>` : "") +
    `<div class="tp-main"><a class="tp-photo" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${d.photo ? `<img src="${esc(d.photo)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : ""}</a>` +
    `<div class="tp-body"><b>${esc(d.title)}</b><small>${esc(d.resort)} · ${esc(d.walk)} · ${d.bedrooms} bedrooms, sleeps ${d.sleeps}</small>` +
    `<small>${esc(d.when)} · flying to ${esc(d.airport)}</small>` +
    `<div class="mp-price"><b>${euro(d.pp)}</b><small>per person all in · ${euro(d.group)} for ${d.people}</small></div></div></div>` +
    pickStatus(p) +
    (p.reason ? `<p class="tp-why">“${esc(p.reason)}” <span class="foot">— ${esc(p.name)}</span></p>` : `<p class="foot">Picked by ${esc(p.name)}</p>`) +
    `<div class="tp-acts"><button type="button" class="btn${mine === p.id ? "" : " secondary"}" data-vote="${esc(p.id)}" aria-pressed="${mine === p.id}">${mine === p.id ? "✓ Your vote" : "Vote for this"}</button>` +
    `<span class="tp-votes"><b>${votes.length}</b> vote${votes.length === 1 ? "" : "s"}${votes.length ? `: ${votes.map(esc).join(", ")}` : ""}</span>` +
    `<a class="tp-open" href="?trip=${esc(tripId())}#${esc(d.share)}">Open this plan</a>` +
    `<a class="tp-open" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">View listing ↗</a></div></article>`;
}

function renderTrip(_s: State) {
  if (!last) return;
  const { trip, picks, votes, ideas } = last;
  const me = myName().toLowerCase();
  const byPick = (id: string) => votes.filter((v) => v.pick === id).map((v) => v.name);
  const mine = votes.find((v) => v.name.toLowerCase() === me)?.pick || "";
  const best = picks.find((p) => p.name === trip.organizer) || picks[0];
  const found = picks.filter((p) => p !== best && p.data.foundBy);
  const rest = picks.filter((p) => p !== best && !p.data.foundBy).sort((a, b) => byPick(b.id).length - byPick(a.id).length);
  const leader = [...picks].sort((a, b) => byPick(b.id).length - byPick(a.id).length)[0];
  $("trip-title").textContent = trip.title ? `Our trip · ${trip.title}` : "Our trip";
  // Keep the pressure visible: how many picks are still bookable, and loudly when the best one is gone.
  const checked = picks.filter((p) => p.status && p.status !== "unchecked");
  const free = checked.filter((p) => p.status !== "unavailable").length;
  const lastIso = checked.map((p) => p.checked || "").sort().pop();
  const alert = best?.status === "unavailable"
    ? `<div class="talert" role="alert">⚠ <b>${esc(trip.organizer)}'s pick is no longer available</b> for these dates. Vote for another pick below or choose a new one: places are going.</div>`
    : picks.some((p) => p.status === "unavailable") ? `<div class="talert warn" role="status">${picks.filter((p) => p.status === "unavailable").length} pick${picks.filter((p) => p.status === "unavailable").length > 1 ? "s are" : " is"} no longer available. Decide soon.</div>` : "";
  const pulse = `<p class="tpulse"><span class="dot" aria-hidden="true"></span>Availability re-checked every 2 hours` +
    (checked.length ? ` · <b>${free} of ${checked.length}</b> pick${checked.length > 1 ? "s" : ""} still free · last check ${when(lastIso)}` : " · first check within 30 min") + `</p>`;
  // Free WhatsApp share: opens WhatsApp with the message ready; the sender picks the chat or group.
  const link = `${location.origin}${location.pathname}?trip=${encodeURIComponent(trip.id)}`;
  const msg = best ? whatsappText(best.data, link) : `⛷️ Our ski trip: vote here ${link}`;
  const wa = `<a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Send on WhatsApp</a>`;
  const box = `<div class="tmsg"><label for="tmsg-text">Message for your group chats</label>` +
    `<textarea id="tmsg-text" readonly rows="12">${esc(msg)}</textarea>` +
    `<div class="tmsg-acts"><button type="button" class="btn" data-act="copy-msg">Copy message</button>${wa}` +
    `<span class="foot">Paste it in each group. The house link shows its photo in WhatsApp.</span></div></div>`;
  $("trip-body").innerHTML = alert + pulse + box +
    (best ? pickCard(best, byPick(best.id), mine, `<b>${esc(trip.organizer)}</b> looked into this — best pick for the group`) : "") +
    found.map((p) => pickCard(p, byPick(p.id), mine, `★ Found by <b>${esc(p.data.foundBy!)}</b>`)).join("") +
    (leader && byPick(leader.id).length && leader !== best ? `<p class="foot">Most votes so far: <b>${esc(leader.data.title)}</b>.</p>` : "") +
    (rest.length ? `<h3 class="tsub">Everyone's picks</h3>` + rest.map((p) => pickCard(p, byPick(p.id), mine, "")).join("") : "") +
    `<h3 class="tsub">Pick your own</h3><p class="foot">Choose a house below (“Choose this house”), set your dates and group, then “Add my pick to the trip”.</p>` +
    ideasHtml(ideas);
}

function ideasHtml(ideas: Idea[]) {
  const label = (x: Idea) => x.status === "approved" ? `<span class="pill p-ok">Approved</span>`
    : x.status === "not approved" ? `<span class="pill p-bad">Not approved</span>`
    : `<span class="pill p-neutral">Waiting for check · every 30 min</span>`;
  const list = ideas.map((x) => `<article class="tidea"><b>${esc(x.name)}</b> ${label(x)}${x.checked ? ` <span class="foot">checked ${when(x.checked)}</span>` : ""}` +
    `<p>${esc(x.text)}</p>` +
    (x.links.length ? `<p>${x.links.map((l) => `<a href="${esc(l)}" target="_blank" rel="noopener noreferrer">${esc(l.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48))}↗</a>`).join(" ")}</p>` : "") +
    (x.images.length ? `<div class="tidea-imgs">${x.images.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer"><img src="${esc(u)}" alt="Screenshot from ${esc(x.name)}" loading="lazy" referrerpolicy="no-referrer"></a>`).join("")}</div>` : "") +
    (x.reply ? `<div class="treply"><span class="eyebrow">${x.status === "not approved" ? "Why not" : "Review"}</span><p>${esc(x.reply)}</p></div>` : "") + `</article>`).join("");
  return `<h3 class="tsub">I have a better option</h3>` +
    `<form id="ideaform" class="ideaform"><p class="foot">Found something better that isn't here? Describe it, paste links and add screenshots. Within 30 minutes it's checked: does it exist, is it free for these dates, at that price? If not, it's marked not approved. If it is and it beats the picks above, it's added and pinned with your name; otherwise you get a reply saying why.</p>` +
    `<label>Your name<input name="name" required maxlength="40" value="${esc(myName())}"></label>` +
    `<label>What's better about it?<textarea name="text" required maxlength="4000" rows="3" placeholder="e.g. 5 bedrooms right on the piste in Soldeu, €3,200 for the week"></textarea></label>` +
    `<label>Links, one per line<textarea name="links" rows="2" placeholder="https://www.airbnb.com/rooms/…"></textarea></label>` +
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
    if (choose) { const id = choose.dataset.pick!; update((s) => { s.pick = s.pick === id ? undefined : id; }); return; }
    const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "create-trip") createTrip(getState(), toast);
    else if (act === "add-pick") addPick(getState(), toast);
    else if (act === "clear-pick") update((s) => { s.pick = undefined; });
    else if (act === "copy-msg") {
      const ta = $("tmsg-text") as HTMLTextAreaElement;
      navigator.clipboard.writeText(ta.value).then(() => toast("Message copied: paste it in each group chat."), () => { ta.select(); toast("Selected: copy it with your phone's Copy."); });
    }
    const v = t.closest<HTMLElement>("[data-vote]");
    if (v) vote(v.dataset.vote!, getState(), toast);
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
