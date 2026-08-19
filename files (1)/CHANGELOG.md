# Change log — SQL backend integration

## Note on file names

The brief listed `dil-fantasy.html`, `dil-fantasy.css`, `dil-fantasy.js`,
`dil-fantasy-register.html/.js`, `dil-fantasy-apply.html/.js` and `dil-fantasy-forms.css`.
**None of those files exist in this project.** The audit was applied to the real files
listed below. There is also no separate "apply" page — applying happens in a modal
reachable from any page, handled by `EntryFlow` in `script.js`.

---

## New files

| File | Purpose |
|---|---|
| `migrations/001_init.sql` | PostgreSQL migration: `users`, `gameweeks`, `registrations`, `leaderboard_stats`, `rewards`, `fpl_snapshots`, `sessions`. All FKs indexed, plus `gameweeks.status` and `registrations.status`. |
| `server/schema.sql` | SQLite translation of the migration — same tables, columns and constraints. |
| `server/db.js` | Connection, migration, gameweek generation, scrypt hashing, AES-256-GCM reward encryption, FPL sync job. |
| `server/index.js` | API server. Zero dependencies (Node 22 `node:sqlite` + `node:http`). Serves API and site on one origin. |
| `server/seed.js` | **Optional**, never automatic. `node server/seed.js` inserts sample rows; `--clear` removes them. |
| `api-client.js` | The only file in the front end that calls `fetch()`. One method per contract endpoint. |
| `API.md` | Endpoint reference, error codes, security notes. |

## Removed

| Removed | Was |
|---|---|
| `MockFPL` (~70 lines, `script.js`) | Fabricated manager names, teams and points in the browser |
| `DemoDB` (~65 lines, `script.js`) | Stand-in participant table in `localStorage` |
| `derivedStats()` (`pages.js`) | Computed dashboard stats from a client-side snapshot |
| `demoFlagIf()` (`pages.js`) | "Demo data" badge — nothing is demo data now |
| `seededRandom()`, `ET_FIRST_NAMES`, `TEAM_NAMES` | Random-data generators |
| `Tournament.participantsFor()` seeded count | `820 + rnd() * 640 + gw * 11` |
| `Auth` local user store | Users in `localStorage` with a placeholder fingerprint |
| `schema.sql` (old root file) | Superseded by `migrations/001_init.sql` |

There is **no offline fallback**. If the API is unreachable the app shows a banner and
renders nothing — verified: 0 participant cards, 0 leaderboard rows.

---

## File-by-file

### `script.js`
- `TimeService.sync()` — now calls `API.time()`; the last stray `fetch()` is gone.
- `Tournament` — gained `server` and `load()`. `gw_number`, open time and deadline come
  from `GET /gameweeks/current`. The browser only counts down toward server timestamps.
- `Tournament.participantsFor()` / `prizePoolFor()` — return cached database values or
  `null`; the UI renders a placeholder until the number arrives.
- **`DataService`** (new) — every figure the app shows, each method one SQL-backed call.
  De-duplicates concurrent identical requests and never caches a failure.
- `FPLService` — reduced to `connectFPLAccount()`, which asks our server.
- `Auth` — reads the `users` table via `api-client.js`. Sync `current()` reads a cache
  hydrated once at boot from `GET /auth/me`.
- **`REGISTRATION_STATUS`** (new) — **item 2**: every status label and note defined once
  here. Keys match the `registrations.status` CHECK constraint.
- `Entries` — `start()`, `markProofSubmitted()`, `verify()` write to `registrations`.
- `connectToDatabase()` / `showOfflineBanner()` (new) — boot gate.

### `pages.js`
- `hydrateLiveCounts()` — **item 1**: fills every `[data-live-count]` from
  `GET /gameweeks/:gw/participants/count`.
- `mountParticipants()` — **items 4 and 6**: the homepage section, with loading skeleton,
  empty state, no-search-match state, error state with retry, and live refresh on
  `dil:participants-changed`.
- `pageLeaderboard()` — **item 3**: rows and stat bar from `GET /leaderboard`. The "you"
  row comes from the session user id, not an index.
- `pageDashboard()` — **item 5**: one aggregated `GET /users/:id/dashboard` call.
  Gameweek number from `gw_number`.
- `pagePerformance()` — rewritten on `GET /users/:id/performance`; charts start at
  Gameweek 1 and lengthen weekly.
- `pageRewards()` — `rewardTotals()` sums the `rewards` rows.
- `pageRegister()` / `pageLogin()` — write to `users`; handlers now `async`.

### HTML (13 files)
- All load `api-client.js` before `script.js`.
- `index.html` — new `#participants` section (**item 4**).
- `leaderboard.html` — new `#lb-stats` bar (**item 3**).
- `dashboard.html` — chart caption now describes Dil Fantasy gameweeks.

### `style.css`
- Added `.participants-bar`, `.participant-grid`, `.participant`, `.participant-state`,
  `.lb-stats`, `.lb-stat`, `.offline-banner`, plus responsive rules.
- **Bug fix**: a generic `input[type="search"]` rule was overriding `.search-field`'s
  `padding-left` at equal specificity, so the magnifier icon sat on top of the placeholder
  text. This affected the existing leaderboard search too.

---

## Verified

Headless browser against the live database:

| Check | Result |
|---|---|
| Live count (item 1) | 28 confirmed, from `COUNT(registrations)` |
| Apply → pending | 4 → 5 |
| Verify → confirmed | 28 → 29; homepage counter followed |
| Review copy (item 2) | Present; confirmed entries show their own note instead |
| Leaderboard (item 3) | 29 rows; `Participants 29 · Average 59 · Highest 82 · Your rank #7` |
| Participants (items 4, 6) | 12 cards, search and paging, you pinned first |
| Dashboard (item 5) | Tournament points 0 → 75, gameweeks played 0 → 1 after verification |
| `yourRank` at `size=1` vs `size=100` | 7 and 7 — computed against the whole table |
| All 13 pages | Load with zero console errors |
| Database unreachable | Banner shown; 0 fabricated rows |
| Deadline forced into the past | `POST /registrations` → 409 `REGISTRATION_CLOSED` |
| Another user's dashboard | 403 `FORBIDDEN` |
| Private keys in public payloads | NONE |
| Reward account | Returned as `••••••5678`; ciphertext at rest |

## Before launch

1. **Administrator authentication.** `POST /registrations/:id/verify` currently lets a user
   verify their own registration so the confirmed state is reachable without an admin
   console. Restrict it to `users.is_admin` and remove the button in `pageDashboard`.
2. **Real FPL integration.** Replace `fetchManagerFromFPL()` in `server/db.js` — the single
   function that stands in for the official API. It writes `fpl_snapshots` and
   `leaderboard_stats`; nothing downstream changes.
3. **Set `DIL_ENCRYPTION_KEY`** (64 hex chars). Without it the server generates a
   development key at `server/.encryption-key`, which must not go to production.
4. **PostgreSQL.** Run `migrations/001_init.sql` and point the server at it. The SQLite
   build exists so the project runs with no setup.

## Running it

```bash
node server/seed.js        # optional sample rows
node server/index.js       # http://localhost:4000
node server/seed.js --clear
```
