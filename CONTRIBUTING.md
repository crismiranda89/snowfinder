# Contributing

Thanks for helping. Most contributions are data, and you don't need to code for them.

## Add a house

Each row is **one price quote**: a house and what it cost for specific dates, for the whole group. To add
the same house for other weeks, add more rows with the same link; only the first row needs the house details.

Add it either:
- **in the group's Google Sheet** (if your group set one up), or
- **in [`data/listings.csv`](data/listings.csv)** via a pull request.

| Column | Example | Notes |
|---|---|---|
| `resort` | `soldeu` | One of the ids in `data/resorts.json` (`mayrhofen`, `les-2-alpes`, `morzine`, `val-thorens`, `pas-de-la-casa`, `soldeu`). El Tarter counts as `soldeu`. |
| `url` | `https://www.airbnb.com/rooms/39173169` | The listing page, `https://` only. |
| `title` | `Spacious Stay w/ Views & Parking` | |
| `bedrooms` | `5` | Real bedrooms (not sofa beds). |
| `sleeps` | `9` | How many people it sleeps. |
| `checkin`, `checkout` | `2027-03-03`, `2027-03-08` | The dates you saw the price for. |
| `total_eur` | `3443` | Total for the whole stay, all fees included. |
| `rating`, `rating_scale` | `4.83`, `5` | Airbnb is out of 5, Booking out of 10. Blank scale = 5 for Airbnb, 10 otherwise. |
| `to_lift_m` | `200` | Walking distance to the nearest lift, in metres. |
| `photo_url` | | Optional. On the listing, right-click the main photo → *Copy image address*. Leave it blank for Airbnb: the weekly job finds it. Booking blocks automated lookups, so paste it for Booking. |
| `added_by` | `cristiano` | |
| `notes` | `2 adjoining apartments` | Short, shown on the card. |

Check your rows before opening a pull request:

```bash
python -m pipeline.build_listings --strict --no-enrich
```

Photos are never copied into the repo. The site shows them from the listing, credited and linked back.

## Fix or add a resort

- Stable facts and the comparison ratings: `data/resorts.json`. Each airport option has its own `id`, the
  road distance and the transfer time.
- This season's prices, closing date and events: `data/season-2027.json` → `resorts` (per resort) and
  `options` (flight, car and transfer per airport option).
- `market` picks the demand row in the season file (which school holidays fill the resort). Add a new row
  if no existing one fits.

## Start a new season

1. Copy `data/season-2027.json` to `data/season-2028.json` and update `weeks`, `demand`, `weekNotes`,
   `holidays`, prices, closing dates and `sources`.
2. Point `src/data.ts` at the new file.
3. `npm test`. The parity test uses frozen copies in `tests/fixtures/original-data/`, so new data doesn't
   break it; only a change to the model would.

## Code

`npm test` and `npm run typecheck` for the site, `python -m pytest -q` for the pipeline, and
`cd bot && npm test` for the bot. Please keep the site dependency-free at runtime.
