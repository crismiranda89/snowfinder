// Snowfinder trip backend: a Google Sheet + this Apps Script, deployed as a web app ("Anyone" can access).
// The site reads a trip with GET ?trip=<id> and writes with POST (JSON body sent as text/plain, so the
// browser makes no CORS preflight). Tabs are created on first use. Friends need no account: they type a
// name, and one vote is kept per name per trip. See sheet/README.md for setup.
//
// Checks run only when the organiser asks, in a Claude Code session (sheet/CHECKER.md), with a key in
// Script Properties as CHECKER_KEY: GET ?checker=<key> lists what to check, POST action "review" /
// "checkPick" / "foundPick" writes the result. Without the key nobody can approve or reject.
//
// The organiser stays in control: a friend's pick or "better option" post is only checked once the
// organiser types "yes" in its `approved` cell (or "no" to decline). Limits against abuse: at most
// MAX_TRIPS trips in the sheet and MAX_PEOPLE names per trip (Script Properties; defaults 12 and 10).
// A trip started from another trip's "challenge a group" link records that trip as `parent`.

const TABS = {
  trips: ["id", "created", "organizer", "title", "parent"],
  picks: ["trip", "id", "created", "name", "reason", "data", "status", "checked", "note", "approved"], // status: unchecked | available | unavailable | changed; approved: yes | no | blank (waiting)
  votes: ["trip", "name", "pick", "updated"],
  ideas: ["trip", "id", "created", "name", "text", "links", "images", "status", "reply", "pick", "checked", "approved"], // status: new | approved | not approved
  people: ["trip", "name", "key", "created"], // a name belongs to the browser that used it first (key = hash of its secret)
  quiz: ["trip", "key", "name", "answers", "guess", "updated"], // the loading games: one row per browser per trip
};
// The loading games' answers, as the site offers them (anything else is dropped).
const QUIZ = ["⛷️ Ski", "🏂 Board", "🌅 First lift", "😴 Lie-in", "🍻 Après", "🛌 Early night", "🫕 Fondue", "🍕 Pizza"];
const MAX_TEXT = 4000, MAX_IMAGES = 3, MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
// Flood limits per person and per trip.
const CAPS = { picksPerName: 2, picksPerTrip: 15, ideasPerName: 3, ideasPerTrip: 20, imagesPerTrip: 30 };
// Only links that can be checked: the listing platforms we use, and their image servers.
const HOSTS = /^https:\/\/([a-z0-9-]+\.)*(airbnb\.[a-z]{2,3}(\.[a-z]{2})?|booking\.com|estiber\.com)\//i;
const IMG_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(bstatic\.com|muscache\.com|estiber\.com|drive\.google\.com)\//i;

function tab_(name) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(TABS[name]); sh.setFrozenRows(1); }
  return sh;
}
function rows_(name) {
  const v = tab_(name).getDataRange().getValues();
  const head = v.shift();
  return v.map((r, i) => Object.assign({ _row: i + 2 }, Object.fromEntries(head.map((k, j) => [k, r[j]]))));
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
const clip_ = (s, n) => String(s == null ? "" : s).slice(0, n || 200).trim();
/** Sheets runs a cell starting with = + - @ as a formula: keep everyone's text as plain text. */
const cell_ = (v) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? "'" + v : v);
const append_ = (tab, row) => tab_(tab).appendRow(row.map(cell_));
/** One person whatever the case, spacing or look-alike characters (full-width letters and so on). */
const norm_ = (s) => clip_(s, 40).normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
const hash_ = (s) => Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s)));
const id_ = () => Utilities.getUuid().replace(/-/g, "").slice(0, 10);
const now_ = () => new Date().toISOString();

const prop_ = (k, d) => +(PropertiesService.getScriptProperties().getProperty(k) || d);
const yes_ = (v) => String(v).trim().toLowerCase() === "yes";
/** Everyone who has taken part in a trip (claimed names). */
function people_(trip) { return new Set(rows_("people").filter((r) => r.trip === trip).map((r) => norm_(r.name))); }
/** A name is claimed by the first browser that uses it on a trip; after that only that browser can use it. */
function claim_(trip, name, key) {
  if (typeof key !== "string" || key.length < 16 || key.length > 80) return "Please reload the page and try again.";
  const who = norm_(name), k = hash_(key), mine = rows_("people").find((r) => r.trip === trip && norm_(r.name) === who);
  if (mine) return mine.key === k ? null : `"${name}" is already taken on this trip. Use your own name.`;
  const max = prop_("MAX_PEOPLE", 10);
  if (people_(trip).size >= max) return `This trip already has ${max} people.`;
  append_("people", [trip, name, k, now_()]);
  return null;
}
/** Keep only the fields a pick card shows, with safe values; null when the house link isn't one we can check. */
function cleanPick_(d) {
  d = d && typeof d === "object" ? d : {};
  const s = (v, n) => clip_(v, n), num = (v) => (Number.isFinite(+v) && +v >= 0 && +v < 1e6 ? Math.round(+v) : 0);
  const url = clip_(d.url, 500);
  if (!HOSTS.test(url) || !s(d.title, 140)) return null;
  const photo = clip_(d.photo, 500);
  return {
    listingId: s(d.listingId, 20).replace(/[^\w]/g, ""), title: s(d.title, 140), url, photo: IMG_HOSTS.test(photo) ? photo : null,
    resort: s(d.resort, 40), airport: s(d.airport, 40), when: s(d.when, 60), people: num(d.people), pp: num(d.pp), group: num(d.group),
    houseTotal: num(d.houseTotal), walk: s(d.walk, 60), bedrooms: num(d.bedrooms), sleeps: num(d.sleeps), share: s(d.share, 3000).replace(/[^\w=-]/g, ""),
  };
}
const checkerOk_ = (k) => { const want = PropertiesService.getScriptProperties().getProperty("CHECKER_KEY"); return !!want && k === want; };

function doGet(e) {
  if (e.parameter.checker != null) {
    if (!checkerOk_(e.parameter.checker)) return json_({ error: "Not allowed" });
    const strip = ({ _row, ...r }) => r;
    const ideas = rows_("ideas"), picks = rows_("picks");
    return json_({
      trips: rows_("trips").map(strip),
      // Only what the organiser approved gets checked.
      ideas: ideas.filter((x) => x.status === "new" && yes_(x.approved)).map((x) => Object.assign(strip(x), { links: safeParse_(x.links, []), images: safeParse_(x.images, []) })),
      declined: ideas.filter((x) => x.status === "new" && String(x.approved).trim().toLowerCase() === "no").map(strip),
      picks: picks.filter((p) => yes_(p.approved)).map((p) => Object.assign(strip(p), { data: safeParse_(p.data) })),
      waiting: {
        picks: picks.filter((p) => !String(p.approved).trim()).map((p) => ({ trip: p.trip, id: p.id, name: p.name, title: safeParse_(p.data).title })),
        ideas: ideas.filter((x) => x.status === "new" && !String(x.approved).trim()).map((x) => ({ trip: x.trip, id: x.id, name: x.name, text: clip_(x.text, 140) })),
      },
      stats: rows_("trips").map((t) => ({ trip: t.id, organizer: t.organizer, people: people_(t.id).size,
        picks: picks.filter((p) => p.trip === t.id).length, votes: rows_("votes").filter((v) => v.trip === t.id).length,
        ideas: ideas.filter((x) => x.trip === t.id).length, unavailable: picks.filter((p) => p.trip === t.id && p.status === "unavailable").length,
        quiz: rows_("quiz").filter((q) => q.trip === t.id).length })),
      quiz: rows_("quiz").map((q) => ({ trip: q.trip, name: q.name, answers: q.answers, guess: q.guess, updated: q.updated })),
    });
  }
  const id = clip_(e.parameter.trip, 20);
  if (!id) return json_({ ok: true });
  const trip = rows_("trips").find((t) => t.id === id);
  if (!trip) return json_({ error: "Trip not found" });
  const latest = {};
  rows_("votes").filter((v) => v.trip === id).forEach((v) => { latest[norm_(v.name)] = { name: v.name, pick: v.pick }; });
  const strip = ({ _row, ...r }) => r;
  return json_({
    trip: strip(trip),
    picks: rows_("picks").filter((p) => p.trip === id).map((p) => Object.assign(strip(p), { data: safeParse_(p.data) })),
    votes: Object.values(latest),
    ideas: rows_("ideas").filter((x) => x.trip === id).map((x) => Object.assign(strip(x), { links: safeParse_(x.links, []), images: safeParse_(x.images, []) })),
    limits: { trips: prop_("MAX_TRIPS", 12), people: prop_("MAX_PEOPLE", 10), tripsUsed: rows_("trips").length, peopleUsed: people_(id).size },
  });
}
function safeParse_(s, d) { try { return JSON.parse(s); } catch (err) { return d === undefined ? {} : d; } }

function doPost(e) {
  const b = safeParse_(e.postData && e.postData.contents);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (["review", "checkPick", "foundPick", "deleteTrip", "approvePick"].includes(b.action)) return json_(checker_(b));
    const name = clip_(b.name, 40).replace(/[\u0000-\u001f]/g, "");
    if (!["createTrip", "addPick", "vote", "idea", "quiz"].includes(b.action)) return json_({ error: "Unknown action" });
    if (b.action !== "createTrip" && !rows_("trips").some((t) => t.id === b.trip)) return json_({ error: "Trip not found" });
    if (b.action === "quiz") return json_(quiz_(b, name));
    if (!name) return json_({ error: "Please give your name" });
    if (b.action === "createTrip") {
      // One trip per group setup for each organiser (same name, same browser): the title starts with the group.
      const group = clip_(b.title, 120).split(" · ")[0], k = hash_(String(b.key || ""));
      const same = rows_("trips").find((t) => String(t.title).split(" · ")[0] === group &&
        rows_("people").some((r) => r.trip === t.id && r.key === k && norm_(r.name) === norm_(t.organizer)));
      if (same) return json_({ error: `You already have a trip for ${group}.`, trip: same.id });
      const max = prop_("MAX_TRIPS", 12);
      if (rows_("trips").length >= max) return json_({ error: `The limit of ${max} trips is reached. Ask the organiser to raise it.` });
      const data = cleanPick_(b.data);
      if (!data) return json_({ error: "Choose one of the site's houses first." });
      const parent = rows_("trips").some((t) => t.id === b.parent) ? b.parent : "";
      const trip = id_();
      append_("trips", [trip, now_(), name, clip_(b.title, 120), parent]);
      const err = claim_(trip, name, b.key); if (err) return json_({ error: err });
      const pick = addPick_(trip, name, b.reason, data, "unchecked", "yes"); // the organiser's own pick needs no approval
      vote_(trip, name, pick);
      return json_({ ok: true, trip, pick });
    }
    const err = claim_(b.trip, name, b.key); if (err) return json_({ error: err });
    const who = norm_(name), mine = (r) => r.trip === b.trip && norm_(r.name) === who;
    if (b.action === "addPick") {
      const data = cleanPick_(b.data);
      if (!data) return json_({ error: "Choose one of the site's houses first." });
      const all = rows_("picks").filter((r) => r.trip === b.trip);
      if (all.filter(mine).length >= CAPS.picksPerName) return json_({ error: `You can add up to ${CAPS.picksPerName} picks.` });
      if (all.length >= CAPS.picksPerTrip) return json_({ error: "This trip has enough picks: vote for one." });
      const pick = addPick_(b.trip, name, b.reason, data); vote_(b.trip, name, pick); return json_({ ok: true, pick });
    }
    if (b.action === "vote") {
      const pick = clip_(b.pick, 20);
      if (!rows_("picks").some((p) => p.trip === b.trip && p.id === pick)) return json_({ error: "That pick isn't on this trip." });
      vote_(b.trip, name, pick); return json_({ ok: true });
    }
    // idea: a "better option" post. It needs a link we can check; it waits for the organiser's OK.
    const links = (Array.isArray(b.links) ? b.links : []).slice(0, 5).map((l) => clip_(l, 500)).filter((l) => HOSTS.test(l));
    if (!links.length) return json_({ error: "Add the Airbnb or Booking.com link of the place." });
    const all = rows_("ideas").filter((r) => r.trip === b.trip);
    if (all.filter(mine).length >= CAPS.ideasPerName) return json_({ error: `You can send up to ${CAPS.ideasPerName} places.` });
    if (all.length >= CAPS.ideasPerTrip) return json_({ error: "This trip has enough suggestions for now." });
    const used = all.reduce((n, r) => n + safeParse_(r.images, []).length, 0);
    const room = Math.max(0, Math.min(MAX_IMAGES, CAPS.imagesPerTrip - used));
    const images = (Array.isArray(b.images) ? b.images : []).slice(0, room).map(saveImage_).filter(Boolean);
    const id = id_();
    append_("ideas", [b.trip, id, now_(), name, clip_(b.text, MAX_TEXT), JSON.stringify(links), JSON.stringify(images), "new", "", "", "", ""]);
    return json_({ ok: true, id });
  } finally { lock.releaseLock(); }
}

function addPick_(trip, name, reason, data, status, approved) {
  const id = id_();
  append_("picks", [trip, id, now_(), name, clip_(reason, 600), JSON.stringify(data || {}).slice(0, 8000), status || "unchecked", "", "", approved || ""]);
  return id;
}

// The checker's writes. review: approve / reject a "better option" post with a reply shown to the group.
// checkPick: record whether a pick is still bookable (and its current price). foundPick: add an approved
// proposal as a pick flagged "Found by <name>" and link it to the post.
function checker_(b) {
  if (!checkerOk_(b.key)) return { error: "Not allowed" };
  if (b.action === "review") {
    const x = rows_("ideas").find((r) => r.id === b.idea); if (!x) return { error: "No such post" };
    if (!["approved", "not approved", "new"].includes(b.status)) return { error: "Bad status" };
    tab_("ideas").getRange(x._row, 8, 1, 4).setValues([[b.status, clip_(b.reply, 2000), clip_(b.pick || x.pick, 20), now_()]]);
    return { ok: true };
  }
  if (b.action === "checkPick") {
    const p = rows_("picks").find((r) => r.id === b.pick); if (!p) return { error: "No such pick" };
    if (!["available", "unavailable", "changed", "unchecked"].includes(b.status)) return { error: "Bad status" };
    const sh = tab_("picks");
    if (b.data) { const d = safeParse_(p.data); for (const k of ["pp", "group", "houseTotal"]) if (Number.isFinite(+b.data[k])) d[k] = Math.round(+b.data[k]); sh.getRange(p._row, 6).setValue(JSON.stringify(d)); }
    sh.getRange(p._row, 7, 1, 3).setValues([[b.status, now_(), clip_(b.note, 600)]]);
    return { ok: true };
  }
  if (b.action === "approvePick") {
    // The organiser's yes/no on a pick, from a review session (same as typing it in the "approved" cell).
    const p = rows_("picks").find((r) => r.id === b.pick); if (!p) return { error: "No such pick" };
    if (!["yes", "no", ""].includes(b.approved)) return { error: "Bad value" };
    tab_("picks").getRange(p._row, 10).setValue(b.approved);
    return { ok: true };
  }
  if (b.action === "deleteTrip") {
    // Removes a trip and everything on it (picks, votes, posts, names). Only with the checker key.
    if (!rows_("trips").some((t) => t.id === b.trip)) return { error: "Trip not found" };
    let n = 0;
    for (const name of ["trips", "picks", "votes", "ideas", "people"]) {
      const col = name === "trips" ? "id" : "trip", sh = tab_(name);
      rows_(name).filter((r) => r[col] === b.trip).map((r) => r._row).sort((a, c) => c - a).forEach((row) => { sh.deleteRow(row); n++; });
    }
    return { ok: true, rows: n };
  }
  if (b.action === "foundPick") {
    const x = rows_("ideas").find((r) => r.id === b.idea); if (!x) return { error: "No such post" };
    const data = cleanPick_(b.data); if (!data) return { error: "Bad pick data" };
    data.foundBy = x.name;
    const pick = addPick_(x.trip, x.name, b.reason || x.text, data, "available", "yes");
    tab_("ideas").getRange(x._row, 8, 1, 4).setValues([["approved", clip_(b.reply, 2000), pick, now_()]]);
    return { ok: true, pick };
  }
}
/** Saves a visitor's loading-game answers and price guess for a trip; again from the same browser replaces it. */
function quiz_(b, name) {
  if (typeof b.key !== "string" || b.key.length < 16 || b.key.length > 80) return { error: "Please reload the page and try again." };
  const answers = (Array.isArray(b.answers) ? b.answers : []).slice(0, 6).map((a) => String(a)).filter((a) => QUIZ.includes(a));
  const g = Math.round(+b.guess), guess = Number.isFinite(g) && g >= 100 && g <= 20000 ? g : "";
  if (!answers.length && guess === "") return { error: "Nothing to save" };
  const k = hash_(b.key), sh = tab_("quiz"), hit = rows_("quiz").find((r) => r.trip === b.trip && r.key === k);
  const row = [b.trip, k, clip_(name, 40), answers.join(" · "), guess, now_()].map(cell_);
  if (hit) sh.getRange(hit._row, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
  return { ok: true };
}
function vote_(trip, name, pick) {
  const sh = tab_("votes"), hit = rows_("votes").find((v) => v.trip === trip && norm_(v.name) === norm_(name));
  if (hit) sh.getRange(hit._row, 3, 1, 2).setValues([[pick, now_()]]);
  else append_("votes", [trip, name, pick, now_()]);
}
function folder_() {
  const it = DriveApp.getFoldersByName("Snowfinder uploads");
  return it.hasNext() ? it.next() : DriveApp.createFolder("Snowfinder uploads");
}
function saveImage_(img) {
  if (!img || !/^image\/(png|jpe?g|webp|gif)$/.test(img.type || "")) return null;
  const bytes = Utilities.base64Decode(String(img.b64 || ""));
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null;
  const f = folder_().createFile(Utilities.newBlob(bytes, img.type, clip_(img.name, 80) || "screenshot"));
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return "https://drive.google.com/thumbnail?sz=w1200&id=" + f.getId();
}
