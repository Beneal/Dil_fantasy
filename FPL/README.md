# Dil Fantasy — Ethiopian Fantasy Premier League competition platform

A production-ready site built with HTML5, CSS3 and vanilla JavaScript, backed by a SQL
database. No build step, no framework, no bundler and no npm install — the API server uses
Node 22's built-in SQLite.

Every figure on every page is read from the database through the API. There is no mock data
and no offline fallback anywhere in the front end.

## Running it

The site needs its database. Node 22+ only — there is nothing to install, because the
server uses Node's built-in SQLite.

```bash
node server/seed.js      # optional: sample rows so the site is not empty
node server/index.js     # serves API + site on http://localhost:4000
```

Opening the HTML files directly will show an "cannot reach the server" banner rather than
figures, which is deliberate: there is no fabricated data anywhere in the front end.

## Files

| File | Purpose |
|---|---|
| `index.html` | Homepage: hero, live clock, news, how it works, tournaments, participants, leaderboard |
| `style.css` | The complete design system (tokens, components, responsive rules) |
| `script.js` | Configuration, EAT time engine, tournament state machine, data + FPL service layers, accounts, entries, UI kit, header/footer |
| `pages.js` | Per-page controllers, shared renderers and the dependency-free SVG charts |
| `leaderboard.html` `tournaments.html` `tournament.html` `news.html` `how-it-works.html` `rules.html` | Public pages |
| `register.html` `login.html` | Account creation and sign-in |
| `dashboard.html` `performance.html` `profile.html` `rewards.html` | Signed-in pages |
| `migrations/001_init.sql` | PostgreSQL migration — the production schema |
| `server/` | API server, database layer and optional seed script |
| `api-client.js` | The only file that calls `fetch()` |
| `API.md` | Endpoint reference |
| `CHANGELOG.md` | File-by-file change log |
| `assets/` | Original SVG brand mark, stadium atmosphere and editorial artwork |

`tournament.html` takes a `?gw=` query parameter, e.g. `tournament.html?gw=3`.

## Configuration

Everything an administrator needs to change lives in the `DIL_CONFIG` object at the top of
`script.js`.

### 1. Telegram payment-proof destination

```js
TELEGRAM_PROOF_URL: 'https://t.me/+dou_6OTMH5ZkZWNk'
```

This one value feeds every Telegram touchpoint: the **Submit proof on Telegram** button in the entry
modal, the resume-proof button on the dashboard, the group links on the tournament and How It Works
pages, and the Telegram icon in the footer. Changing the group means editing this line only.

If it is ever set back to an empty string the app does not invent a link: standalone group links hide
themselves, the entry modal shows a configuration notice, and the entry is still recorded so the rest
of the flow stays testable.

### 2. Season schedule

```js
SEASON: {
  firstGameweek: 1,
  seasonAnchorUTC: Date.UTC(2026, 7, 15, 21, 0, 0)  // Sun 16 Aug 2026, 00:00 EAT
}
```

`seasonAnchorUTC` is the moment Gameweek 1 opened, expressed in UTC. Sunday 00:00 EAT is Saturday
21:00 UTC. Everything else — the current gameweek, the deadline, the countdown, the button states —
is derived from this one value and the clock. The gameweek increments every Sunday at 12:00 AM EAT,
indefinitely, with no manual step.

### 3. Registration window

```js
REGISTRATION: {
  opensDayOffset: 0, opensHourEAT: 0,      // Sunday 12:00 AM EAT
  closesDayOffset: 5, closesHourEAT: 14,   // Friday 2:00 PM EAT
  closingSoonHours: 24
}
```

### 4. The database

`schema.sql` is the contract between this front end and your server. It defines
seven tables — `users`, `reward_accounts`, `gameweeks`, `entries`,
`gameweek_scores`, `rewards`, `news_posts` — and, below them, the labelled query
(A–H) behind each screen. Run it against PostgreSQL as-is; MySQL differences are
noted inline.

Every displayed number is a query result. Nothing is calculated in the browser:

| Screen | Reads | Query |
|---|---|---|
| Hero clock, tournament cards, detail page | `DataService.getTournamentSummary` | A |
| Homepage "Who's playing this gameweek" | `DataService.getParticipants` | B |
| Leaderboard table, homepage snapshot | `FPLService.getLeaderboardData` | C |
| Leaderboard stat bar | `DataService.getLeaderboardStats` | D |
| Dashboard tiles and chart, performance page | `DataService.getMyGameweekHistory` | E |
| Creating an entry | `Entries.start` | F |
| Admin verification | `Entries.simulateVerification` | G |
| Countdown clock | `TimeService.sync` | H |

Endpoints these expect:

```
GET  /tournaments/:gameweek/summary
GET  /tournaments/:gameweek/participants?search=&page=&page_size=
GET  /leaderboard?gameweek=&scope=&size=
GET  /leaderboard/stats?gameweek=&scope=
GET  /me/gameweeks
POST /entries                        POST /entries/:gameweek/proof
POST /admin/entries/:id/verify
GET  /time
```

**Participant counts.** The live figure is the count of entries at status
`confirmed` for that gameweek. Applying moves an entry into the *pending* column;
only an administrator's verification moves it into *confirmed*. The two numbers
are displayed separately on the homepage so submitting proof is never mistaken
for approval.

**Privacy.** Query B's SELECT list is the whole public contract: manager name,
FPL team name, status, applied-at. There is no join to `reward_accounts`
anywhere in `schema.sql`, and the participant card can only render what that
query returns. Do not widen it.

**Demo mode.** With `apiBaseUrl` empty, `DemoDB` in `script.js` stands in for
these tables, holding the same columns. It carries an opening roster so the
directory is not empty, and registering or applying in the browser inserts into
it — so the counters genuinely move. Everything it returns is tagged
`source: 'demo'` and rendered with a visible **Demo data** flag.

### 5. Backend and FPL data

```js
API: { apiBaseUrl: '' }   // e.g. 'https://api.dilfantasy.et/v1'
```

Setting this switches both `DataService` and `FPLService` from demo data to your
server. No UI code changes.

The official FPL API sends no CORS headers and cannot be called from a browser. While `apiBaseUrl`
is empty, `FPLService` answers from clearly-labelled demo data and every affected panel shows a
**Demo data** flag. Set `apiBaseUrl` and the same functions call your server instead — no other code
changes:

| Function | Endpoint expected |
|---|---|
| `TimeService.sync()` | `GET /time` → `{ epochMs }` |
| `FPLService.connectFPLAccount(id)` / `getManagerData(id)` | `GET /fpl/manager/:id` |
| `FPLService.getGameweekData(gw)` | `GET /fpl/gameweek/:gw` |
| `FPLService.getLeaderboardData({...})` | `GET /leaderboard?gameweek=&scope=&size=` |

Payment proof submission is marked `// [BACKEND]` in `Entries.markProofSubmitted` and should become
`POST /entries/:gw/proof`.

## Security notes

- **No API keys belong in this front end.** All FPL traffic must be proxied by your server.
- **The deadline must be enforced server-side.** The browser disables every registration control at
  Friday 2:00 PM EAT, but a user can change their device clock. `TimeService` already supports a
  signed server timestamp via `GET /time`; the server must still revalidate the gameweek,
  registration window, user eligibility and payment status on every entry attempt.
- **Accounts are browser-local in this build.** `Auth` stores users in `localStorage` with a
  placeholder fingerprint, not a password hash. Registration, login, sessions and hashing all move
  to the server. Nothing in `Auth` is a security boundary.
- **No online checkout exists, by design.** There is no payment gateway, no card form and no
  Telebirr or CBE API call. Users pay through their own provider and send a screenshot.

## Behaviour worth knowing

- **The countdown survives refresh, sleep and reopened tabs** because every value is computed from
  absolute UTC milliseconds rather than a running timer.
- **Rollover is automatic.** Leave a tab open across Friday 2:00 PM and every apply button disables
  itself; leave it open across Sunday 12:00 AM and the gameweek increments, registration reopens and
  a toast announces it.
- **The dashboard starts at Gameweek 1.** The points chart plots one point per
  Dil Fantasy gameweek you have played, so it begins with an honest empty state
  and gains a point each week as scores are published. Tournament points,
  gameweeks played and winnings all accumulate from your rows rather than being
  fixed figures.
- **Demo verification.** Payment proof never auto-approves. On the dashboard, an entry under review
  shows a clearly-labelled *Demo: simulate admin verification* button so the confirmed state is
  reachable without an admin backend. Remove it once real verification exists.
- **Demo FPL IDs.** Any numeric Manager ID connects; IDs ending in `0` deliberately return the
  not-found error so the error state is testable.

## Accessibility and performance

Semantic landmarks, a skip link, labelled form fields with inline errors, ARIA tab and dialog
patterns with focus trapping and Escape handling, keyboard-navigable charts, visible focus rings,
and `prefers-reduced-motion` respected throughout. States are never signalled by colour alone.

No JavaScript libraries are loaded. Charts are hand-rolled SVG, icons are inline SVG, imagery is
vector, and images below the fold are lazy-loaded.


## Troubleshooting

### "Cannot reach the Dil Fantasy server"

The site reads every figure from the database, so it needs the API running. This banner
means the page loaded but `/api` did not answer. Three common causes:

**1. The server is not running.** Start it, and leave the terminal open:

```bash
node server/index.js
```

**2. You opened the HTML file directly.** A `file://` URL, or double-clicking
`index.html`, has no server to call. Open **http://localhost:4000** instead.

**3. You are on a different port.** Live Server, `python -m http.server` and similar tools
serve the files but not the API, so `/api` returns 404. Use the bundled server — it serves
both the API and the site on one origin.

The banner is deliberate. Rather than filling the page with invented numbers, the site
disables the apply buttons, blanks the countdown and marks each section unavailable, so
nothing on screen can be mistaken for real data.

### Node version

Requires Node 22 or newer — the server uses the built-in `node:sqlite` module. Check with
`node --version`.
