// Runs the real sheet/Code.gs in Node with in-memory stand-ins for Google's services, for attack tests.
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";

export function boot(props = { CHECKER_KEY: "s3cret-checker-key-0123456789abcdef" }) {
  const sheets = {}, files = [];
  const sheet = (name) => {
    const rows = [];
    return {
      name, rows,
      appendRow: (r) => rows.push(r.map((v) => (v === undefined ? "" : v))),
      setFrozenRows: () => {},
      deleteRow: (row) => { rows.splice(row - 1, 1); },
      getDataRange: () => ({ getValues: () => rows.map((r) => r.slice()) }),
      getRange: (row, col, nr = 1, nc = 1) => ({
        setValues: (vals) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) rows[row - 1 + i][col - 1 + j] = vals[i][j]; },
        setValue: (v) => { rows[row - 1][col - 1] = v; },
      }),
    };
  };
  const ss = { getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = sheet(n)) };
  const ctx = {
    SpreadsheetApp: { getActive: () => ss },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (s) => ({ setMimeType: () => ({ body: s }) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null }) },
    Utilities: {
      getUuid: () => randomUUID(),
      base64Decode: (s) => [...Buffer.from(s, "base64")],
      newBlob: (bytes, type, name) => ({ bytes, type, name }),
      DigestAlgorithm: { SHA_256: "sha256" },
      computeDigest: (_alg, s) => [...createHash("sha256").update(s).digest()],
      base64Encode: (bytes) => Buffer.from(bytes).toString("base64"),
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 1 }, Permission: { VIEW: 1 },
      getFoldersByName: () => ({ hasNext: () => false }),
      createFolder: () => ({ createFile: (blob) => { const f = { id: "f" + files.length, blob, setSharing() {}, getId: () => f.id }; files.push(f); return f; } }),
    },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL("../Code.gs", import.meta.url), "utf8"), ctx);
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: typeof body === "string" ? body : JSON.stringify(body) } }).body);
  const get = (parameter) => JSON.parse(ctx.doGet({ parameter }).body);
  return { post, get, sheets, files };
}

export const pickData = (over = {}) => ({
  listingId: "e4ca9ff38c", title: "Quiet chalet", url: "https://www.airbnb.com/rooms/916662346341396629", photo: null,
  resort: "Les 2 Alpes", airport: "Turin (TRN)", when: "Thu 4 Mar → Tue 9 Mar", people: 6, pp: 1116, group: 6696,
  houseTotal: 3939, walk: "10 min walk to the lifts", bedrooms: 4, sleeps: 12, share: "", ...over,
});
