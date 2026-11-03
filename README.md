# Evandale Panthers Cricket Club – website

One-page site (`index.html`, `css/styles.css`, `js/main.js`) plus three small
Vercel functions that bring in real data.

## Where the data comes from

| On the site | Comes from | Who updates it |
|---|---|---|
| Fixtures, results, ladder, next-match countdown | **PlayHQ**, via `/api/fixtures` | Automatic – whatever is entered in PlayHQ on match day |
| Squad, news, gallery, sponsors, teams & training, contact details | **Club Google Sheet**, via `/api/content` | Any committee member with edit access to the sheet |
| Join form sign-ups | Sent to a **private Google Sheet** + email, via `/api/join` | Arrives automatically |
| Anything not connected yet | `data/content.json` (backup) | Edit on GitHub |

Every source is optional. Until something is connected, the site uses the
backup file, so you can deploy today and connect things one at a time.

```
index.html, css/, js/, assets/   the website
api/fixtures.js                  PlayHQ → fixtures, results, ladder
api/content.js                   Google Sheet → squad, news, gallery, sponsors…
api/join.js                      join form → private Google Sheet + email
data/content.json                backup content
docs/sheet-template/*.csv        one CSV per tab for the club Google Sheet
docs/join-form-apps-script.gs    script for the sign-ups sheet
```

---

## 1. Deploy to Vercel
1. Push this folder to a GitHub repo.
2. Vercel → **Add New → Project** → import the repo.
3. Framework preset **Other**, leave build settings empty, **Deploy**.

Every setting below goes in Vercel → Project → **Settings → Environment
Variables**. After adding or changing one, go to **Deployments → ⋯ → Redeploy**.

## 2. Connect PlayHQ (fixtures, results, ladder)
Ask the association to request PlayHQ API access for the club. Then add:

| Name | Value |
|---|---|
| `PLAYHQ_API_KEY` | the API key / Client ID |
| `PLAYHQ_ORG_ID` | Evandale Panthers' PlayHQ organisation ID |
| `PLAYHQ_TENANT` | `ca` (default, can leave out) |
| `PLAYHQ_TEAM_MATCH` | optional – text in our team names, default `Evandale` |
| `HOME_VENUE_MATCH` | optional – text in our home ground's name, default `Evandale` |
| `PLAYHQ_SEASON_IDS` | optional – force season IDs, normally leave empty |

Check: open `https://<your-site>.vercel.app/api/fixtures?debug=1`. It lists the
seasons, the Panthers teams it found and any ladder errors. The fixtures table
on the homepage then says "Live from PlayHQ".

## 3. Connect the club Google Sheet (squad, news, gallery…)
1. Create a Google Sheet called e.g. **Panthers website**.
2. Make six tabs named exactly **Club, Teams, Squad, News, Gallery, Sponsors**.
   For each one, File → Import → Upload the matching CSV from
   `docs/sheet-template/` → "Replace current sheet".
3. Share → General access → **Anyone with the link – Viewer**.
   (Only people you add as Editors can change it.)
4. Copy the ID from the sheet's URL:
   `docs.google.com/spreadsheets/d/`**`THIS-LONG-PART`**`/edit`
5. In Vercel add `GOOGLE_SHEET_ID` = that ID, then redeploy.

Changes in the sheet show on the site within about 5 minutes.

**Tab guide**
- **Club** – `key | value` rows: `email`, `phone`, `ground`, `ground_address`,
  `map_query`, `facebook`, `instagram`, `playhq_url`, `training`, `registration_url`,
  `show_junior_players` (`no` by default – see below)
- **Teams** – `name | competition | gender | blurb | plays | training`.
  The 2026/27 teams are already filled in: Premier League, A-Grade, B-Grade,
  C-Grade, Female Boom (TCL) and U12s Division 2 (Cricket North). Keep the
  names the same as PlayHQ minus "Evandale Panthers" so fixture tabs, ladder
  and squad groups line up. gender: Men / Women / Mixed.
- **Squad** – `name | role | team | gender | captain | photo | note`.
  role: Batter / Bowler / All-rounder / Keeper. captain: `C` or `VC`.
  gender can be left blank – it's taken from the player's team.
  On the site, players are grouped by team and can be filtered by team,
  men's/women's and role.

**Junior players (U12s):** set `show_junior_players` in the Club tab:
- `no` (default) – the U12s team appears in the squad with a privacy message, no names
- `first_names` – first name + surname initial only (e.g. "Sam T."), no photos
- `yes` – full names and photos

Only use `first_names` or `yes` with parents' permission.
- **News** – `date | title | summary | link | image`. Newest shows first.
  Dates like `3/11/2026` or `2026-11-03` both work.
- **Gallery** – `image | caption`
- **Sponsors** – `name | url | logo | tier`

**Photos:** upload to a Google Drive folder shared as "Anyone with the link",
then paste the file's share link into the `photo`, `image` or `logo` column –
the site converts Drive links automatically. Don't use Facebook photo links;
they expire.

Only people who've agreed should have their name and photo on the squad list.
For juniors, get a parent's OK first.

## 4. Connect the join form
Sign-ups contain personal details, so they go to a **separate private sheet**,
never the link-shared website sheet.
1. Create a new Google Sheet, e.g. **Panthers sign-ups**. Don't share it publicly.
2. Extensions → Apps Script. Paste in `docs/join-form-apps-script.gs`.
3. In the script set `SECRET` (any long random phrase) and `NOTIFY_EMAIL`.
4. Deploy → New deployment → Web app. Execute as **Me**, access **Anyone**.
   Authorise it, then copy the URL ending in `/exec`.
5. In Vercel add `JOIN_WEBHOOK_URL` = that URL and `JOIN_WEBHOOK_SECRET` = the
   same phrase as `SECRET`. Redeploy.

Each sign-up adds a row to the "Join requests" tab and emails `NOTIFY_EMAIL`.
Until this is set up, the form offers to email the club's address instead.

## Who has admin access
- **Website content:** Editors on the Google Sheet.
- **Sign-ups:** people the private sign-ups sheet is shared with.
- **Code and settings:** collaborators on the GitHub repo and members of the
  Vercel project. Keep this to one or two people.
- **Fixtures and results:** whoever already manages the club in PlayHQ.

Never put API keys or secrets in the code or the sheet – only in Vercel.

## Run and test in VS Code
You need **Node.js 18 or newer** (nodejs.org → LTS). No other installs.

1. Unzip the folder, then in VS Code: **File → Open Folder** → `evandale-panthers`.
2. Open the terminal: **Terminal → New Terminal**.
3. Run one of these:

| Command | What you get |
|---|---|
| `npm run demo` | Every section working with **fake** data – fixtures, results, ladder, squad, news, join form. Best for testing the look and features. |
| `npm run dev` | **Real** mode. Uses settings in `.env.local`; anything not set uses `data/content.json`. |

4. Open **http://localhost:3000** in your browser.
5. Edit any file, save, and refresh the browser to see the change.
6. Stop the server with **Ctrl + C** in the terminal.

You can also use VS Code's **Run and Debug** panel (Ctrl + Shift + D) and pick
"Website – demo data" or "Website – real data".

**Testing with real data:** copy `.env.example` to `.env.local`, fill in what
you have (PlayHQ key and org ID, Google Sheet ID, join webhook), then
`npm run dev`. The terminal shows which ones are connected.
`.env.local` is never uploaded (it's in `.gitignore`).

If port 3000 is busy: `PORT=3005 npm run demo` (Mac/Linux) or
`$env:PORT=3005; npm run demo` (Windows PowerShell).
