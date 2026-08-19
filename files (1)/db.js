/* =====================================================================
   DIL FANTASY — database layer
   node:sqlite (built into Node 22+), so there is nothing to npm install.
   Table and column names match migrations/001_init.sql exactly.
   ===================================================================== */

'use strict';

const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG = {
  // Gameweek 1 opened Sunday 16 Aug 2026 at 00:00 EAT (= Sat 15 Aug 21:00 UTC).
  SEASON_ANCHOR_MS: Date.UTC(2026, 7, 15, 21, 0, 0),
  WEEK_MS: 7 * 24 * 60 * 60 * 1000,
  // Friday 14:00 EAT sits 5 days 11 hours after the Sunday 00:00 EAT open.
  DEADLINE_OFFSET_MS: (5 * 24 + 11) * 60 * 60 * 1000,
  ENTRY_FEE: 200,
  PRIZE_POOL_RATIO: 70,
  WEEKS_TO_GENERATE: 60,
  TIMEZONE: 'Africa/Addis_Ababa'
};

const DB_PATH = process.env.DIL_DB || path.join(__dirname, 'dil-fantasy.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

/* ------------------------------------------------------------ migration */
function migrate() {
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
}

/* --------------------------------------------------------- reward crypto
   Reward account numbers are encrypted at rest with AES-256-GCM. No API
   response ever returns the plaintext; the profile page shows a masked
   value the server derives, so a leaked response cannot expose an account.
   [BACKEND] Set DIL_ENCRYPTION_KEY (64 hex chars) in the environment. */
const ENC_KEY = (() => {
  const raw = process.env.DIL_ENCRYPTION_KEY;
  if (raw && /^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  const keyFile = path.join(__dirname, '.encryption-key');
  if (fs.existsSync(keyFile)) return Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
  const generated = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, generated.toString('hex'), { mode: 0o600 });
  console.warn('[dil] generated a development encryption key at server/.encryption-key');
  return generated;
})();

function encrypt(plain) {
  if (plain == null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}

function decrypt(stored) {
  if (!stored) return null;
  try {
    const [iv, tag, data] = String(stored).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString('utf8');
  } catch (err) {
    return null;
  }
}

/** Shows only the last four digits — the only form the API ever returns. */
function maskAccount(stored) {
  const plain = decrypt(stored);
  if (!plain) return null;
  const tail = plain.slice(-4);
  return `${'•'.repeat(Math.max(0, plain.length - 4))}${tail}`;
}

/* -------------------------------------------------------------- password */
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(plain, salt, 64).toString('hex')}`;
}

function verifyPassword(plain, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(plain, salt, 64);
  const known = Buffer.from(hash, 'hex');
  return test.length === known.length && crypto.timingSafeEqual(test, known);
}

/* ------------------------------------------------------------ gameweeks */
const weekStart = (n) => CONFIG.SEASON_ANCHOR_MS + (n - 1) * CONFIG.WEEK_MS;
const deadline  = (n) => weekStart(n) + CONFIG.DEADLINE_OFFSET_MS;

/** Fills the gameweeks table so the schedule is data, never client maths. */
function generateGameweeks() {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO gameweeks
      (gw_number, registration_open_at, registration_close_at, next_gw_start_at,
       entry_fee, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'upcoming', ?)`);
  const now = Date.now();
  for (let n = 1; n <= CONFIG.WEEKS_TO_GENERATE; n++) {
    insert.run(n, weekStart(n), deadline(n), weekStart(n + 1), CONFIG.ENTRY_FEE, now);
  }
  refreshGameweekStatus(now);
}

/** Keeps gameweeks.status in step with the clock. */
function refreshGameweekStatus(now = Date.now()) {
  db.prepare(`UPDATE gameweeks SET status = CASE
      WHEN ? <  registration_open_at  THEN 'upcoming'
      WHEN ? <  registration_close_at THEN 'open'
      WHEN ? <  next_gw_start_at      THEN 'active'
      ELSE 'completed' END`).run(now, now, now);
}

/** The gameweek running right now, read from the table. */
function currentGameweek(now = Date.now()) {
  const row = db.prepare(`
    SELECT * FROM gameweeks WHERE registration_open_at <= ?
    ORDER BY gw_number DESC LIMIT 1`).get(now);
  return row || db.prepare('SELECT * FROM gameweeks WHERE gw_number = 1').get();
}

const gameweekByNumber = (n) =>
  db.prepare('SELECT * FROM gameweeks WHERE gw_number = ?').get(Number(n));

/* ------------------------------------------------- FPL sync job (server)
   [BACKEND] Replace fetchManagerFromFPL() with a real call to the official
   Fantasy Premier League API. Everything downstream stays unchanged: the
   job writes fpl_snapshots and leaderboard_stats rows, and the browser
   only ever reads those tables through the API.                         */

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function fetchManagerFromFPL(managerId, gwNumber) {
  const rnd = seededRandom((Number(managerId) || 1) + gwNumber * 7919);
  const base = 46 + Math.floor(seededRandom(Number(managerId) || 1)() * 20);
  return {
    gwPoints: Math.max(18, Math.round(base + (rnd() - 0.45) * 34)),
    overallRank: Math.round(600000 + (rnd() - 0.5) * 380000),
    teamValue: Number((98.5 + rnd() * 6).toFixed(1))
  };
}

/**
 * Writes one fpl_snapshots row and one leaderboard_stats row per user per
 * finished gameweek. previous_rank is stored so movement is read, never
 * recomputed. Safe to run repeatedly.
 */
function syncFplData(now = Date.now()) {
  refreshGameweekStatus(now);
  /* Gameweeks that have opened: completed ones are written once and left
     alone, while the live gameweek is refreshed on every sync because FPL
     publishes provisional points during the week. */
  const opened = db.prepare(
    `SELECT * FROM gameweeks WHERE registration_open_at <= ? ORDER BY gw_number`).all(now);
  if (!opened.length) return { snapshots: 0, stats: 0 };

  const users = db.prepare(
    'SELECT id, full_name, fpl_manager_id, fpl_team_name FROM users WHERE fpl_manager_id IS NOT NULL'
  ).all();

  const insertSnap = db.prepare(`
    INSERT OR REPLACE INTO fpl_snapshots
      (user_id, gameweek_id, manager_name, team_name, overall_rank,
       total_points, team_value, gw_points, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const upsertStat = db.prepare(`
    INSERT INTO leaderboard_stats
      (user_id, gameweek_id, gw_points, total_points, overall_rank, previous_rank, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, gameweek_id) DO UPDATE SET
      gw_points = excluded.gw_points, total_points = excluded.total_points,
      overall_rank = excluded.overall_rank, updated_at = excluded.updated_at`);
  const priorRank = db.prepare(`
    SELECT overall_rank FROM leaderboard_stats ls
    JOIN gameweeks g ON g.id = ls.gameweek_id
    WHERE ls.user_id = ? AND g.gw_number = ?`);

  let snapshots = 0;
  let stats = 0;
  for (const user of users) {
    let running = 0;
    for (const gw of opened) {
      const settled = gw.next_gw_start_at <= now;
      const data = fetchManagerFromFPL(user.fpl_manager_id, gw.gw_number);
      running += data.gwPoints;
      const prev = priorRank.get(user.id, gw.gw_number - 1);
      const existing = db.prepare(
        'SELECT id FROM leaderboard_stats WHERE user_id = ? AND gameweek_id = ?')
        .get(user.id, gw.id);
      // A completed gameweek is written once; the live one keeps refreshing.
      if (settled && existing) continue;
      if (insertSnap.run(user.id, gw.id, user.full_name, user.fpl_team_name,
        data.overallRank, running, data.teamValue, data.gwPoints, now).changes) snapshots++;
      if (upsertStat.run(user.id, gw.id, data.gwPoints, running, data.overallRank,
        prev ? prev.overall_rank : null, now).changes) stats++;
    }
  }
  return { snapshots, stats };
}

function init() {
  migrate();
  generateGameweeks();
  syncFplData();
}

module.exports = {
  db, CONFIG, DB_PATH,
  init, migrate, generateGameweeks, refreshGameweekStatus, syncFplData,
  currentGameweek, gameweekByNumber, weekStart, deadline,
  hashPassword, verifyPassword, encrypt, decrypt, maskAccount, seededRandom
};
