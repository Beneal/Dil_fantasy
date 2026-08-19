-- =====================================================================
--  DIL FANTASY — SQLite translation of migrations/001_init.sql
--  Same tables, same columns, same constraints and indexes. This is the
--  one the bundled Node server runs, so the project works with no setup.
--  Timestamps are epoch milliseconds (INTEGER) rather than TIMESTAMPTZ.
-- =====================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name                TEXT    NOT NULL,
  age                      INTEGER NOT NULL CHECK (age >= 18),
  phone                    TEXT    NOT NULL,
  email                    TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash            TEXT    NOT NULL,
  fpl_manager_id           TEXT,
  fpl_team_name            TEXT,
  reward_method            TEXT CHECK (reward_method IN ('telebirr','cbe','bank')),
  reward_account_encrypted TEXT,
  is_admin                 INTEGER NOT NULL DEFAULT 0,
  created_at               INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_fpl_manager_id_key
  ON users (fpl_manager_id) WHERE fpl_manager_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

CREATE TABLE IF NOT EXISTS gameweeks (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  gw_number             INTEGER NOT NULL UNIQUE CHECK (gw_number >= 1),
  registration_open_at  INTEGER NOT NULL,
  registration_close_at INTEGER NOT NULL,
  next_gw_start_at      INTEGER NOT NULL,
  entry_fee             INTEGER NOT NULL DEFAULT 200,
  status                TEXT    NOT NULL DEFAULT 'upcoming'
                        CHECK (status IN ('upcoming','open','closed','active','completed')),
  created_at            INTEGER NOT NULL,
  CHECK (registration_close_at > registration_open_at),
  CHECK (next_gw_start_at > registration_close_at)
);
CREATE INDEX IF NOT EXISTS gameweeks_status_idx    ON gameweeks (status);
CREATE INDEX IF NOT EXISTS gameweeks_gw_number_idx ON gameweeks (gw_number);

CREATE TABLE IF NOT EXISTS registrations (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gameweek_id          INTEGER NOT NULL REFERENCES gameweeks(id) ON DELETE CASCADE,
  payment_method       TEXT,
  payment_reference    TEXT,
  status               TEXT    NOT NULL DEFAULT 'awaiting_proof'
                       CHECK (status IN ('awaiting_proof','proof_submitted','under_review',
                                         'verified','rejected','confirmed')),
  submitted_at         INTEGER NOT NULL,
  verified_at          INTEGER,
  verified_by_admin_id INTEGER REFERENCES users(id),
  UNIQUE (user_id, gameweek_id)
);
CREATE INDEX IF NOT EXISTS registrations_user_idx      ON registrations (user_id);
CREATE INDEX IF NOT EXISTS registrations_gameweek_idx  ON registrations (gameweek_id);
CREATE INDEX IF NOT EXISTS registrations_status_idx    ON registrations (status);
CREATE INDEX IF NOT EXISTS registrations_gw_status_idx ON registrations (gameweek_id, status);

CREATE TABLE IF NOT EXISTS leaderboard_stats (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gameweek_id   INTEGER NOT NULL REFERENCES gameweeks(id) ON DELETE CASCADE,
  gw_points     INTEGER NOT NULL DEFAULT 0,
  total_points  INTEGER NOT NULL DEFAULT 0,
  overall_rank  INTEGER,
  previous_rank INTEGER,
  updated_at    INTEGER NOT NULL,
  UNIQUE (user_id, gameweek_id)
);
CREATE INDEX IF NOT EXISTS leaderboard_stats_user_idx ON leaderboard_stats (user_id);
CREATE INDEX IF NOT EXISTS leaderboard_stats_gw_idx   ON leaderboard_stats (gameweek_id);
CREATE INDEX IF NOT EXISTS leaderboard_stats_rank_idx ON leaderboard_stats (gameweek_id, gw_points DESC);

CREATE TABLE IF NOT EXISTS rewards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gameweek_id INTEGER NOT NULL REFERENCES gameweeks(id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
  paid_at     INTEGER,
  UNIQUE (user_id, gameweek_id)
);
CREATE INDEX IF NOT EXISTS rewards_user_idx     ON rewards (user_id);
CREATE INDEX IF NOT EXISTS rewards_gameweek_idx ON rewards (gameweek_id);
CREATE INDEX IF NOT EXISTS rewards_status_idx   ON rewards (status);

CREATE TABLE IF NOT EXISTS fpl_snapshots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gameweek_id  INTEGER NOT NULL REFERENCES gameweeks(id) ON DELETE CASCADE,
  manager_name TEXT,
  team_name    TEXT,
  overall_rank INTEGER,
  total_points INTEGER,
  team_value   REAL,
  gw_points    INTEGER,
  fetched_at   INTEGER NOT NULL,
  UNIQUE (user_id, gameweek_id)
);
CREATE INDEX IF NOT EXISTS fpl_snapshots_user_idx ON fpl_snapshots (user_id);
CREATE INDEX IF NOT EXISTS fpl_snapshots_gw_idx   ON fpl_snapshots (gameweek_id);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
