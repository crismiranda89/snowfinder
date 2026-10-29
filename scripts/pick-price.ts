// Prices a house the way the site does, for the checker (sheet/CHECKER.md).
//   node scripts/pick-price.ts <share> <listingId> [<listingId> …]
// <share> is a pick's data.share ("s=…"); prints one JSON line per house: per person all in, group total,
// house total and the cheapest airport, for that pick's group, dates and settings.
import { decodeShare } from "../src/state.ts";
import { SEASON } from "../src/data.ts";
import { pickSummary } from "../src/ui/render.ts";

const [share, ...ids] = process.argv.slice(2);
const s = share && decodeShare("#" + share.replace(/^#/, ""), SEASON.weeks.length);
if (!s || !ids.length) { console.error("usage: node scripts/pick-price.ts <share> <listingId>…"); process.exit(2); }
for (const id of ids) {
  const p = pickSummary({ ...s, pick: id });
  console.log(JSON.stringify(p
    ? { id, title: p.listing.title, resort: p.resort.name, when: p.when, people: p.people, pp: Math.round(p.pp), group: Math.round(p.group), houseTotal: Math.round(p.houseTotal), airport: p.option.code, walk: p.walk }
    : { id, error: "unknown house, or every resort option is closed that week" }));
}
