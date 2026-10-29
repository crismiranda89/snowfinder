// Snowfinder trip backend: a Google Sheet + this Apps Script, deployed as a web app ("Anyone" can access).
// The site reads a trip with GET ?trip=<id> and writes with POST (JSON body sent as text/plain, so the
// browser makes no CORS preflight). Tabs are created on first use. Friends need no account: they type a
// name, and one vote is kept per name per trip. See sheet/README.md for setup.
//
// A checker (sheet/CHECKER.md, every 30 minutes) validates proposals with a private key stored in
// Script Properties as CHECKER_KEY: GET ?checker=<key> lists what to check, POST action "review" /
// "checkPick" / "foundPick" writes the result. Without the key nobody can approve or reject.

const TABS = {
  trips: ["id", "created", "organizer", "title"],
  picks: ["trip", "id", "created", "name", "reason", "data", "status", "checked", "note"], // data = JSON of the pick; status: unchecked | available | unavailable | changed
  votes: ["trip", "name", "pick", "updated"],
  ideas: ["trip", "id", "created", "name", "text", "links", "images", "status", "reply", "pick", "checked"], // status: new | approved | not approved
};
const MAX_TEXT = 4000, MAX_IMAGES = 3, MAX_IMAGE_BYTES = 4 * 1024 * 1024;

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
const id_ = () => Utilities.getUuid().replace(/-/g, "").slice(0, 10);
const now_ = () => new Date().toISOString();

const checkerOk_ = (k) => { const want = PropertiesService.getScriptProperties().getProperty("CHECKER_KEY"); return !!want && k === want; };

function doGet(e) {
  if (e.parameter.checker != null) {
    if (!checkerOk_(e.parameter.checker)) return json_({ error: "Not allowed" });
    const strip = ({ _row, ...r }) => r;
    return json_({
      trips: rows_("trips").map(strip),
      ideas: rows_("ideas").filter((x) => x.status === "new").map((x) => Object.assign(strip(x), { links: safeParse_(x.links, []), images: safeParse_(x.images, []) })),
      picks: rows_("picks").map((p) => Object.assign(strip(p), { data: safeParse_(p.data) })),
    });
  }
  const id = clip_(e.parameter.trip, 20);
  if (!id) return json_({ ok: true });
  const trip = rows_("trips").find((t) => t.id === id);
  if (!trip) return json_({ error: "Trip not found" });
  const latest = {};
  rows_("votes").filter((v) => v.trip === id).forEach((v) => { latest[String(v.name).toLowerCase()] = { name: v.name, pick: v.pick }; });
  const strip = ({ _row, ...r }) => r;
  return json_({
    trip: strip(trip),
    picks: rows_("picks").filter((p) => p.trip === id).map((p) => Object.assign(strip(p), { data: safeParse_(p.data) })),
    votes: Object.values(latest),
    ideas: rows_("ideas").filter((x) => x.trip === id).map((x) => Object.assign(strip(x), { links: safeParse_(x.links, []), images: safeParse_(x.images, []) })),
  });
}
function safeParse_(s, d) { try { return JSON.parse(s); } catch (err) { return d === undefined ? {} : d; } }

function doPost(e) {
  const b = safeParse_(e.postData && e.postData.contents);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (b.action === "review" || b.action === "checkPick" || b.action === "foundPick") return json_(checker_(b));
    const name = clip_(b.name, 40);
    if (b.action !== "createTrip" && !rows_("trips").some((t) => t.id === b.trip)) return json_({ error: "Trip not found" });
    if (!name) return json_({ error: "Please give your name" });
    if (b.action === "createTrip") {
      const trip = id_();
      tab_("trips").appendRow([trip, now_(), name, clip_(b.title, 120)]);
      const pick = addPick_(trip, name, b.reason, b.data);
      vote_(trip, name, pick);
      return json_({ ok: true, trip, pick });
    }
    if (b.action === "addPick") { const pick = addPick_(b.trip, name, b.reason, b.data); vote_(b.trip, name, pick); return json_({ ok: true, pick }); }
    if (b.action === "vote") { vote_(b.trip, name, clip_(b.pick, 20)); return json_({ ok: true }); }
    if (b.action === "idea") {
      const images = (b.images || []).slice(0, MAX_IMAGES).map(saveImage_).filter(Boolean);
      const links = (b.links || []).slice(0, 10).map((l) => clip_(l, 500)).filter((l) => /^https?:\/\//.test(l));
      const id = id_();
      tab_("ideas").appendRow([b.trip, id, now_(), name, clip_(b.text, MAX_TEXT), JSON.stringify(links), JSON.stringify(images), "new", "", ""]);
      return json_({ ok: true, id });
    }
    return json_({ error: "Unknown action" });
  } finally { lock.releaseLock(); }
}

function addPick_(trip, name, reason, data, status) {
  const id = id_();
  tab_("picks").appendRow([trip, id, now_(), name, clip_(reason, 600), JSON.stringify(data || {}).slice(0, 8000), status || "unchecked", "", ""]);
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
    if (b.data) sh.getRange(p._row, 6).setValue(JSON.stringify(Object.assign(safeParse_(p.data), b.data)).slice(0, 8000));
    sh.getRange(p._row, 7, 1, 3).setValues([[b.status, now_(), clip_(b.note, 600)]]);
    return { ok: true };
  }
  if (b.action === "foundPick") {
    const x = rows_("ideas").find((r) => r.id === b.idea); if (!x) return { error: "No such post" };
    const data = Object.assign({}, b.data || {}, { foundBy: x.name });
    const pick = addPick_(x.trip, x.name, b.reason || x.text, data, "available");
    tab_("ideas").getRange(x._row, 8, 1, 4).setValues([["approved", clip_(b.reply, 2000), pick, now_()]]);
    return { ok: true, pick };
  }
}
function vote_(trip, name, pick) {
  const sh = tab_("votes"), hit = rows_("votes").find((v) => v.trip === trip && String(v.name).toLowerCase() === name.toLowerCase());
  if (hit) sh.getRange(hit._row, 3, 1, 2).setValues([[pick, now_()]]);
  else sh.appendRow([trip, name, pick, now_()]);
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
