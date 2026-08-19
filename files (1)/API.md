# Dil Fantasy — API reference

Base URL `/api`. The server serves the API and the static site on one origin, so the
browser needs no CORS configuration.

- Content type is `application/json` on every request and response.
- The session is an **HttpOnly cookie** (`dil_session`) set at register/login. JavaScript
  cannot read it, so no token is ever stored in the front end.
- All timestamps are **epoch milliseconds, UTC**. Ethiopia Time (EAT) is UTC+3 with no
  daylight saving; the browser formats for display, the server stores UTC.
- Every response is `Cache-Control: no-store`.

Errors use one shape:

```json
{ "error": { "message": "Registration for Gameweek 1 is closed.", "code": "REGISTRATION_CLOSED" } }
```

| Code | Meaning |
|---|---|
| `VALIDATION` | A field was missing or invalid |
| `EMAIL_TAKEN` | `users.email` UNIQUE constraint |
| `FPL_TAKEN` | `users.fpl_manager_id` UNIQUE constraint |
| `FPL_REQUIRED` | Entering requires a connected Manager ID |
| `REGISTRATION_CLOSED` | Past `gameweeks.registration_close_at` |
| `UNAUTHENTICATED` | No valid session |
| `FORBIDDEN` | Signed in, but not your record |
| `NOT_FOUND` / `CONFLICT` | Missing row / wrong state |
| `NETWORK` | Client-side only: the server could not be reached |

---

## Contract

| Method | Endpoint | Reads from |
|---|---|---|
| GET | `/api/gameweeks/current` | `gameweeks` |
| GET | `/api/gameweeks/:gw/participants/count` | `registrations` |
| GET | `/api/gameweeks/:gw/participants` | `registrations` + `users` |
| GET | `/api/leaderboard?gameweek=&scope=` | `leaderboard_stats` + `users` + `registrations` |
| GET | `/api/users/:id/dashboard` | `registrations` + `leaderboard_stats` + `rewards` |
| GET | `/api/users/:id/performance` | `gameweeks` ⟕ the rest |
| GET | `/api/users/:id/rewards` | `rewards` |
| POST | `/api/registrations` | `registrations` |
| POST | `/api/registrations/:id/proof` | `registrations` |
| POST | `/api/registrations/:id/verify` | `registrations` |

Supporting endpoints: `/api/time`, `/api/auth/register`, `/api/auth/login`,
`/api/auth/logout`, `/api/auth/me`, `/api/me/registrations`, `/api/me/fpl`,
`/api/me/reward`, `/api/fpl/manager/:id`.

---

## GET /api/gameweeks/current

The gameweek number is a column, never client arithmetic.

```json
{
  "gameweek": {
    "id": 1, "gwNumber": 1,
    "registrationOpenAt": 1786827600000,
    "registrationCloseAt": 1787299200000,
    "nextGwStartAt": 1787432400000,
    "entryFee": 200, "status": "open", "registrationOpen": true
  },
  "next": { "gwNumber": 2, "status": "upcoming", "...": "..." },
  "entryFee": 200, "prizePoolRatio": 70,
  "timezone": "Africa/Addis_Ababa", "serverTime": 1787173438411
}
```

`status` is one of `upcoming`, `open`, `active`, `completed`, maintained against the clock.

## GET /api/gameweeks/:gw/participants/count

The single source of every participant number on the site.

```json
{
  "gwNumber": 1, "confirmed": 28, "pending": 4, "applied": 32,
  "entryFee": 200, "collected": 5600, "prizePool": 3900,
  "registrationCloseAt": 1787299200000, "status": "open"
}
```

`confirmed` counts `registrations.status = 'confirmed'` only. `pending` covers
`proof_submitted`, `under_review` and `verified`. **Submitting proof is not approval** —
only a verified entry raises `confirmed`.

## GET /api/gameweeks/:gw/participants

Query: `search`, `page` (default 1), `page_size` (default 12, max 48).

```json
{
  "gwNumber": 1, "page": 1, "pageSize": 12,
  "total": 32, "confirmed": 28, "pending": 4,
  "rows": [
    { "displayName": "Mekdes Abebe", "teamName": "Sheger United",
      "initials": "MA", "status": "confirmed",
      "appliedAt": 1786841684626, "isYou": false }
  ]
}
```

**Privacy contract.** Those six fields are the entire public shape. There is no join to
`users.email`, `users.phone`, `users.age`, `users.reward_method` or
`users.reward_account_encrypted` anywhere in this query, so no change to the front end can
expose them. The signed-in user sorts first, then confirmed entries, then by application
time.

## GET /api/leaderboard

Query: `gameweek` (default current), `scope` (`gameweek` | `overall`), `size` (max 200).

```json
{
  "gwNumber": 1, "scope": "gameweek",
  "rows": [
    { "rank": 1, "userId": 22, "managerName": "Mekdes Abebe",
      "teamName": "Sheger United", "initials": "MA",
      "gwPoints": 82, "totalPoints": 82, "overallRank": 620457,
      "movement": 0, "isYou": false }
  ],
  "stats": {
    "participants": 29, "ranked": 29, "averagePoints": 59,
    "highestPoints": 82, "topManager": "Mekdes Abebe",
    "yourRank": 7, "updatedAt": 1787173990986
  }
}
```

Only `status = 'confirmed'` registrations appear. `movement` compares this gameweek's
placing with the previous gameweek's (positive means moved up). `isYou` comes from the
session, never a hardcoded row index.

`stats.yourRank` is computed against the **whole** table, not the returned page — asking
for `size=1` to render the stat bar still returns your true rank.

## GET /api/users/:id/dashboard

One aggregated call. Returns 403 unless `:id` is you or you are an administrator.

```json
{
  "userId": 33, "currentGameweek": 1,
  "gameweek": { "...": "..." },
  "registration": { "id": 33, "gwNumber": 1, "status": "confirmed",
                    "entryFee": 200, "submittedAt": 0, "verifiedAt": 0 },
  "stats": {
    "currentRank": 7, "gwPoints": 75, "totalPoints": 75, "overallRank": 620457,
    "entries": 1, "confirmedEntries": 1, "scoredGameweeks": 1,
    "winningsPaid": 0, "winningsPending": 0
  }
}
```

Every figure is a `SUM` or `COUNT` over that user's rows, so the tiles grow as the season
runs rather than being fixed values.

## GET /api/users/:id/performance

One row per gameweek from `gw_number` 1 to the current one — a `LEFT JOIN` from
`gameweeks`, so a gameweek stays visible while its score is unpublished. This is why the
chart starts at Gameweek 1 and lengthens weekly instead of being a static array.

```json
{
  "userId": 33, "currentGameweek": 3,
  "rows": [
    { "gwNumber": 1, "gameweekStatus": "completed", "registrationStatus": "confirmed",
      "gwPoints": 75, "totalPoints": 75, "overallRank": 620457, "previousRank": null,
      "winnings": 0, "rewardStatus": null, "played": true, "settled": true }
  ]
}
```

## POST /api/registrations

Body `{ "gameweek": 1, "paymentMethod": "telebirr" }`. Creates an `awaiting_proof` row.

**The deadline is enforced here.** The insert only proceeds when
`registration_open_at <= NOW() < registration_close_at`. The browser also disables the
button, but a device clock can be changed, so this is the check that counts. Re-entering
returns the existing row with `alreadyRegistered: true` (the `UNIQUE (user_id,
gameweek_id)` constraint).

## POST /api/registrations/:id/proof

Body `{ "paymentReference": "...", "paymentMethod": "telebirr" }`. Moves
`awaiting_proof` → `under_review`. Refused after the deadline.

## POST /api/registrations/:id/verify

Body `{ "approve": true }`. Moves `proof_submitted` / `under_review` / `verified` →
`confirmed` (or `rejected`), stamps `verified_at` and `verified_by_admin_id`, then re-runs
the FPL sync. **This is the only path that raises the participant count.**

> **Before launch:** put this behind real administrator authentication. Today a user can
> call it for their own registration so the confirmed state is reachable without an admin
> console. Restrict it to `users.is_admin` and remove the button in `pageDashboard`.

---

## Security notes

- **No secrets in the front end.** `api-client.js` holds no keys. The session cookie is
  HttpOnly; the encryption key lives in `DIL_ENCRYPTION_KEY` on the server.
- **Passwords** are hashed with scrypt and a per-user salt. Login returns the same message
  for an unknown email and a wrong password, so responses cannot enumerate accounts.
- **Reward accounts** are encrypted at rest with AES-256-GCM. No endpoint returns the
  plaintext — `/auth/me` returns `accountMasked` (`••••••5678`) derived server-side.
- **Authorization**: `/users/:id/*` returns 403 unless the id is the session's own user.
- **The FPL API is never called from the browser.** It sends no CORS headers and
  credentials belong on the server. `server/db.js → fetchManagerFromFPL()` is the single
  function to replace with the real integration; it writes `fpl_snapshots` and
  `leaderboard_stats`, and the front end only reads those tables.
