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
4. **Review key:** in Apps Script, **Project Settings (gear) → Script properties → Add script property**,
   name `CHECKER_KEY`, value the key in `~/.snowfinder/checker.json`. Only your review sessions
   ([CHECKER.md](CHECKER.md)) use it; it is what lets a review approve or reject proposals.
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
  can it be reviewed. Your own pick is approved automatically. Until then the group only sees "N picks
  waiting for <you>'s OK": the details stay hidden, so spam never reaches them.
- **Rules against abuse:** a name belongs to the browser that used it first on a trip (nobody can vote or
  post as you); 2 picks and 3 suggested places per person; 15 picks, 20 places and 30 photos per trip;
  only Airbnb / Booking.com links; text is stored as plain text (no spreadsheet formulas).
- **Limits:** at most 4 trips and 10 people per trip. Change them in **Project Settings → Script
  properties** with `MAX_TRIPS` and `MAX_PEOPLE`.
- **Challenge another group:** after you confirm your pick, the trip offers to send Snowfinder to another
  group of friends. Their trip remembers who challenged them (the `parent` column).
- **I have a better option:** an Airbnb or Booking.com link (required), text and up to 3 screenshots
  land in the `ideas` tab. You review them yourself in a Claude Code session ([CHECKER.md](CHECKER.md)):
  nothing reads or acts on submissions automatically, so a post can't trick an AI into doing anything.
  A better place is added to the site and pinned as "Found by <name>"; otherwise the post gets a reply.
- **Availability:** you re-check picks when you want, in the same session; a house that's gone shows
  "No longer available for these dates" with the weeks it's free.

## Changing the script later

After editing `Code.gs`, use **Deploy → Manage deployments → Edit → Version: New version** so the same
URL keeps working.

Anyone with the URL can write to the sheet, so keep the trip link to the group.
