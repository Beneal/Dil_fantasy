-- =====================================================================
--  DIL FANTASY — 001_init
--  PostgreSQL migration. A SQLite translation of the same tables and
--  columns runs the bundled server (server/schema.sql).
--
--  `registrations` is the single source of truth for participant counts.
--  No other table stores a count, and no counter is cached anywhere.
-- =====================================================================

BEGIN;

-- ---- users -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                       BIGSERIAL PRIMARY KEY,
  full_name                VARCHAR(120) NOT NULL,
  age                      SMALLINT     NOT NULL CHECK (age >= 18),
  phone                    VARCHAR(32)  NOT NULL,
  email                    VARCHAR(190) NOT NULL UNIQUE,
  password_hash            VARCHAR(255) NOT NULL,   -- scrypt/argon2. Never plaintext.
  fpl_manager_id           VARCHAR(16),
  fpl_team_name            VARCHAR(120),
  reward_method            VARCHAR(16) CHECK (reward_method IN ('telebirr','cbe','bank')),
  reward_account_encrypted TEXT,                    -- AES-256-GCM, never returned by any endpoint
  is_admin                 BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_fpl_manager_id_key
  ON users (fpl_manager_id) WHERE fpl_manager_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

-- ---- gameweeks -------------------------------------------------------
--  gw_number is authoritative. The client never calculates a gameweek.
CREATE TABLE IF NOT EXISTS gameweeks (
  id                     BIGSERIAL PRIMARY KEY,
  gw_number              INTEGER     NOT NULL UNIQUE CHECK (gw_number >= 1),
  registration_open_at   TIMESTAMPTZ NOT NULL,   -- Sunday 00:00 EAT
  registration_close_at  TIMESTAMPTZ NOT NULL,   -- Friday 14:00 EAT
  next_gw_start_at       TIMESTAMPTZ NOT NULL,
  entry_fee              INTEGER     NOT NULL DEFAULT 200,
  status                 VARCHAR(16) NOT NULL DEFAULT 'upcoming'
                         CHECK (status IN ('upcoming','open','closed','active','completed')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (registration_close_at > registration_open_at),
  CHECK (next_gw_start_at > registration_close_at)
);

CREATE INDEX IF NOT EXISTS gameweeks_status_idx    ON gameweeks (status);
CREATE INDEX IF NOT EXISTS gameweeks_gw_number_idx ON gameweeks (gw_number);

-- ---- registrations ---------------------------------------------------
--  THE source of truth for participant counts.
--  Submitting proof is not approval: only 'confirmed' counts.
CREATE TABLE IF NOT EXISTS registrations (
  id                    BIGSERIAL PRIMARY KEY,
  user_id               BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gameweek_id           BIGINT      NOT NULL REFERENCES gameweeks(id) ON DELETE CASCADE,
  payment_method        VARCHAR(16),
  payment_reference     VARCHAR(120),
  status                VARCHAR(20) NOT NULL DEFAULT 'awaiting_proof'
                        CHECK (status IN ('awaiting_proof','proof_submitted','under_review',
                                          'verified','rejected','confirmed')),
  submitted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at           TIMESTAMPTZ,
  verified_by_admin_id  BIGINT REFERENCES users(id),
  UNIQUE (user_id, gameweek_id)
);

CREATE INDEX IF NOT EXISTS registrations_user_idx     ON registrations (user_id);
CREATE INDEX IF NOT EXISTS registrations_gameweek_idx ON registrations (gameweek_id);
CREATE INDEX IF NOT EXISTS registrations_status_idx   ON registrations (status);
CREATE INDEX IF NOT EXISTS registrations_gw_status_idx ON registrations (gameweek_id, status);

-- ---- leaderboard_stats -----------------------------------------------
--  previous_rank is stored so rank movement is read, never recomputed.
CREATE TABLE IF NOT EXISTS leaderboard_stats (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gameweek_id   BIGINT      NOT NULL REFERENCES gameweeks(id) ON DELETE CASCADE,
  gw_points     INTEGER     NOT NULL DEFAULT 0,
  total_points  INTEGER     NOT NULL DEFAULT 0,
  overall_rank  INTEGER,
  previous_rank INTEGER,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, gameweek_id)
);

CREATE INDEX IF NOT EXISTS leaderboard_stats_user_idx ON leaderboard_stats (user_id);
CREATE INDEX IF NOT EXISTS leaderboard_stats_gw_idx   ON leaderboard_stats (gameweek_id);
CREATE INDEX IF NOT EXISTS leaderboard_stats_rank_idx ON leaderboard_stats (gameweek_id, gw_points DESC);

-- ---- rewards ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS rewards (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gameweek_id BIGINT      NOT NULL REFERENCES gameweeks(id) ON DELETE CASCADE,
  amount      INTEGER     NOT NULL,
  status      VARCHAR(12) NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','paid','failed')),
  paid_at     TIMESTAMPTZ,
  UNIQUE (user_id, gameweek_id)
);

CREATE INDEX IF NOT EXISTS rewards_user_idx     ON rewards (user_id);
CREATE INDEX IF NOT EXISTS rewards_gameweek_idx ON rewards (gameweek_id);
CREATE INDEX IF NOT EXISTS rewards_status_idx   ON rewards (status);

-- ---- fpl_snapshots ---------------------------------------------------
--  Written by the server-side FPL sync job. The browser never calls the
--  FPL API: it has no CORS headers and credentials belong on the server.
CREATE TABLE IF NOT EXISTS fpl_snapshots (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gameweek_id  BIGINT      NOT NULL REFERENCES gameweeks(id) ON DELETE CASCADE,
  manager_name VARCHAR(120),
  team_name    VARCHAR(120),
  overall_rank INTEGER,
  total_points INTEGER,
  team_value   NUMERIC(5,1),
  gw_points    INTEGER,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, gameweek_id)
);

CREATE INDEX IF NOT EXISTS fpl_snapshots_user_idx ON fpl_snapshots (user_id);
CREATE INDEX IF NOT EXISTS fpl_snapshots_gw_idx   ON fpl_snapshots (gameweek_id);

-- ---- sessions --------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  token      VARCHAR(64) PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

COMMIT;

-- =====================================================================
--  THE COUNT THAT DRIVES THE SITE
--  Every participant number on every page resolves to this one query.
--  There is no second data path and no cached counter.
-- =====================================================================
--   SELECT
--     COUNT(*) FILTER (WHERE r.status = 'confirmed')  AS confirmed,
--     COUNT(*) FILTER (WHERE r.status IN ('proof_submitted','under_review','verified'))
--                                                     AS pending,
--     COUNT(*) FILTER (WHERE r.status <> 'rejected')  AS applied
--   FROM registrations r
--   JOIN gameweeks g ON g.id = r.gameweek_id
--   WHERE g.gw_number = $1;
--
--  PUBLIC PARTICIPANT LIST — this SELECT list is the privacy contract.
--  It must never grow to include email, phone, age, reward_method or
--  reward_account_encrypted. There is no join to those columns here.
--   SELECT u.full_name, u.fpl_team_name, r.status, r.submitted_at
--   FROM registrations r
--   JOIN users u ON u.id = r.user_id
--   JOIN gameweeks g ON g.id = r.gameweek_id
--   WHERE g.gw_number = $1 AND r.status <> 'rejected';
