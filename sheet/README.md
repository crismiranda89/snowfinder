# Shared trips: Google Sheet setup

Trips, picks, votes and "I have a better option" posts are stored in a Google Sheet you own. Friends
need no account: they open the trip link and type their name. Screenshots go to a Drive folder,
"Snowfinder uploads", shared as view-only links.

## One-time setup (about 5 minutes)

1. Create a new Google Sheet (sheets.new), for example "Snowfinder trips".
2. **Extensions → Apps Script.** Delete what's there, paste all of [`Code.gs`](Code.gs), and save.
3. **Deploy → New deployment →** type **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
   Click **Deploy**, allow the permissions it asks for (Sheets and Drive), and copy the **Web app URL**
   (`https://script.google.com/macros/s/…/exec`).
4. **Checker key:** in Apps Script, **Project Settings (gear) → Script properties → Add script property**,
   name `CHECKER_KEY`, value a long random string (Claude gives you one). Only the 30-minute checker
   ([CHECKER.md](CHECKER.md)) knows it; it is what lets it approve or reject proposals.
5. In the GitHub repo: **Settings → Secrets and variables → Actions → Variables → New repository
   variable**, name `SHEET_API`, value the URL from step 3.
6. Re-run the **Deploy site** workflow (or push anything). "Create our trip" appears once a house is chosen.

The tabs (`trips`, `picks`, `votes`, `ideas`) are created on first use.

## How it works

- **Create our trip:** choose a house, then "Create our trip". You give your name and a reason; the
  link opens with your pick on top as the group's best pick.
- **Friends** vote (one vote per name, changeable), or choose their own house and "Add my pick".
- **You approve everything from the forms.** A friend's pick or "better option" post shows "Waiting for
  <you>'s OK" until you type `yes` (or `no`) in its `approved` cell in the `picks` or `ideas` tab. Only then
  does the checker look at it. Your own pick is approved automatically. The checker sends you a phone
  notification when something is waiting or anything changes (votes, picks, availability).
- **Limits:** at most 4 trips and 10 people per trip. Change them in **Project Settings → Script
  properties** with `MAX_TRIPS` and `MAX_PEOPLE`.
- **Challenge another group:** after you confirm your pick, the trip offers to send Snowfinder to another
  group of friends. Their trip remembers who challenged them (the `parent` column).
- **I have a better option:** text, links and up to 3 screenshots land in the `ideas` tab with status
  `new`. Every 30 minutes the checker opens the links for the trip's dates: not bookable, or not better
  than the picks, sets `not approved` with the reason in `reply`; better adds it to the site and to
  `picks` with `"foundBy": "<name>"`, pinned on the trip as "Found by <name>".
- **Picks are re-checked about every 2 hours.** A house that's gone or no longer free shows "No longer
  available for these dates", and the checker searches the same house across the season and notes the
  free weeks.

## Changing the script later

After editing `Code.gs`, use **Deploy → Manage deployments → Edit → Version: New version** so the same
URL keeps working.

Anyone with the URL can write to the sheet, so keep the trip link to the group.
