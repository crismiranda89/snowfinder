# Architecture

How the site is put together. The user-facing overview is in the [README](../README.md); the shared-trip
backend is in [sheet/README.md](../sheet/README.md) and the review process in [sheet/CHECKER.md](../sheet/CHECKER.md).

## Pieces

| Piece | Where | Runs |
|---|---|---|
| Site (TypeScript, no runtime deps) | `index.html`, `src/` | In the browser. esbuild bundles it to `dist/`, GitHub Pages serves it |
| Data | `data/` | Static JSON/CSV in the repo; `data/generated/listings.json` is built by the pipeline |
| Listings pipeline (Python) | `pipeline/` | Weekly GitHub Action (*Refresh house listings*) or by hand |
| Shared trips backend | `sheet/Code.gs` | Google Apps Script web app on the organiser's Google Sheet |
| Telegram vote bot (optional) | `bot/` | Cloudflare Worker + D1 |

The site's only network calls are to the Apps Script URL, baked in at build time from the `SHEET_API`
repository variable (`<meta name="snowfinder-api">`). Without it, shared trips are switched off and the
rest of the site works the same.

## Source map (`src/`)

| File | What it does |
|---|---|
| `main.ts` | Boot: restores state (a share link wins over saved state), renders, wires every control, the fold system and the pinned price bar |
| `state.ts` | `State`, defaults, `localStorage`, share-link encode/decode, named `GROUPS` and `normGroup` |
| `data.ts` | Imports the season, resorts and listings JSON |
| `types.ts` | Shared types |
| `model/cost.ts` | Price per person for a resort × week × airport option (flight, car/transfer, house, pass, rental, food, lessons) |
| `model/calendar.ts` | Season weeks, nights, food days, date helpers |
| `model/group.ts` | Bedrooms, cars and vans a group needs |
| `model/houses.ts` | Which houses fit a group, levels (Budget/Mid/Luxury), walking time to lifts |
| `ui/render.ts` | All the HTML for steps 1–3, the pinned bar, Food (i) pop-up, `breakdownList` |
| `ui/deck.ts` | The stacked-card picker used instead of dropdowns |
| `ui/sort.ts` | Sortable tables in Go deeper |
| `ui/haptic.ts` | Short vibration on taps (Android only) |
| `ui/promo.ts` | The 1080×1350 promo image (house photo split diagonally with the resort, details card) and its preview with Share / Save / Copy link; from "Share this plan" and step 4 |
| `trip.ts` | Shared trips: welcome card, "My pick", create/add pick, votes, step 4, Top picks, "I have a better plan" |
| `loader.ts` | The card slider used for the games (ski style duel + price guess) and the reveal |
| `styles.css` | All styles, one file |

## Page, top to bottom

1. **Welcome card** (`#welcome`, trip links only). Shows the organiser's pick and their lines. While the
   trip loads and nothing is cached it shows a shimmer skeleton ("🎿 Loading the suggested trip…").
   *Explore* closes it and scrolls to step 1. It only redraws when its HTML changes, so a tap isn't lost.
2. **Group and Filters**: couples, solo friends (room kind or sofa), resorts, food plan (Food (i) shows the
   hand-set meal price per resort × the plan multiplier; not a median).
3. **Step 1 Dates** (`#grid-block`): resort × week grid. Dates (i) explains it shows every available house
   for the filters, and picking a week filters them. "❌ Let's not complicate" hides the extra weeks.
4. **Step 2 Houses** (`#houses-block`): fitting houses, by price level or by distance.
5. **Step 3 Flights and others** (`#rank-block`): airport options for the chosen house. Choosing one folds
   step 3 and scrolls to the pick (on a trip link, to the welcome card when it's the organiser's own house
   and flight).
6. **My pick** (`#mypick`) with "Create our trip" / "Add my pick to the trip". A pick already in the trip
   (same house, flight and dates) shows 🔒 Lock it instead, then "✓ In the trip, with your vote".
7. **Games** (`#pick-games`): as soon as the name is saved, two quick games play right under the pick while
   the sheet saves it (`playGames(title, saving)`). When both are done and the save is in, the price reveal
   plays, the games are removed, the result lines move into `#trip-loader`, and step 4 opens.
8. **Step 4 Confirm availability** (`#trip-block`): "Share on WhatsApp" and "Copy text" on top (the
   group-chat message, no text box), trip name, availability dot (red "not checked yet" or green
   "checked · X of Y still free"), votes: each pick with its check dot, pros and cons, "Vote for this"
   and "View listing". No separate pick cards.
9. **🏅 Top picks** (`#trips-block`): featured trips (`FEATURED` in `trip.ts`) plus trips this browser has
   seen or made, filtered by group with steppers that only offer values that exist.
10. **📊 Go deeper** (`#deeper-block`): which resort suits whom, resort comparison, week detail with
    editable prices.
11. **💡 I have a better plan** (`#better-block`, trip links only): "Pick your own" and the "better option"
    form (Airbnb/Booking link, text, up to 3 screenshots).

## Fold system (`main.ts`)

- `fold(key, closed, remember)` opens/closes a section; `remember` saves it in `snowfinder-folded-v5`.
- `advance(from, to, target)` folds one step, opens the next and glides to `target`.
- `FOLDED_AT_START` lists the sections closed on a first visit. Step 4 (`trip-block`) is closed on every
  load that isn't a trip link; on a trip link only Dates is open. Bump the key's version to reset everyone's
  saved folds after changing the defaults.

## Shared trip flow

1. Organiser chooses a house + flight → *Create our trip* → name and reason → `POST createTrip`. The link is
   `?trip=<id>`; the share hash carries the whole plan.
2. A friend opens the link: welcome card → 🔒 *Lock it* (a `POST vote` for the organiser's pick) or
   *Explore other options* → choose their own → *Add my pick* → `POST addPick` (waits for the organiser's
   `yes` in the sheet) → games → step 4. Votes are `POST vote`; after Lock it, step 4 opens on the votes.
3. Game answers and price guesses go to `POST quiz` (one row per browser per trip).
4. Shared links open with all resorts selected (`dest = []`).

The sheet enforces the rules (name ownership per browser, caps, Airbnb/Booking links only, plain text).
See [sheet/README.md](../sheet/README.md).

## Browser storage keys

`snowfinder-v1` (state), `snowfinder-folded-v5`, `snowfinder-filters-open`, `snowfinder-house-view`,
`snowfinder-name`, `snowfinder-key` (this browser's name claim), `snowfinder-my-trips`,
`snowfinder-seen-trips`, `snowfinder-trip-<id>` (cached trip), `snowfinder-played-v2`, `snowfinder-style`.

## Tests

- `npm test`: cost model, houses, share links, and `golden.test.ts` (10,368 prices from the original
  prototype, exact match).
- `npm run typecheck`.
- `npm run test:sheet`: `sheet/tests/attacks.mjs`, abuse cases against `Code.gs` in a local harness.
- `python -m pytest -q`: pipeline. `cd bot && npm test`: bot.
