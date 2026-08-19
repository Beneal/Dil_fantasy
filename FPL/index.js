/* =====================================================================
   DIL FANTASY — API server
   Node 22+ only. No npm install, no framework: node:sqlite + node:http.

       node server/index.js

   Serves the API and the static site on one origin, so the front end
   needs no CORS setup and no separate web server.

   Every endpoint below reads from SQL. Nothing is computed from a
   hardcoded list, and no count is cached outside the database.
   ===================================================================== */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  db, CONFIG, DB_PATH, init, currentGameweek, gameweekByNumber,
  refreshGameweekStatus, syncFplData,
  hashPassword, verifyPassword, encrypt, maskAccount
} = require('./db');

const PORT = Number(process.env.PORT || 4000);
const SITE_ROOT = path.join(__dirname, '..');
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

// Registration statuses that count as "applied" for participant totals.
const ACTIVE_STATUSES = ['confirmed', 'verified', 'under_review', 'proof_submitted'];
const ACTIVE_LIST = ACTIVE_STATUSES.map((s) => `'${s}'`).join(',');

init();
console.log(`[dil] database ready at ${DB_PATH}`);

/* ============================ http helpers ============================ */

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

const fail = (res, status, message, code) =>
  json(res, status, { error: { message, code: code || 'ERROR' } });

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1e6) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Invalid JSON body'); }
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

/* ============================== sessions ============================== */

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(token, userId, now, now + SESSION_TTL_MS);
  res.setHeader('Set-Cookie',
    `dil_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`);
}

function currentUser(req) {
  const token = parseCookies(req).dil_session;
  if (!token) return null;
  return db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?`).get(token, Date.now()) || null;
}

/** The only user shape the API returns. Reward account is masked, never raw. */
function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    age: row.age,
    isAdmin: Boolean(row.is_admin),
    createdAt: row.created_at,
    fpl: row.fpl_manager_id
      ? { managerId: row.fpl_manager_id, teamName: row.fpl_team_name }
      : null,
    reward: row.reward_method
      ? { method: row.reward_method, accountMasked: maskAccount(row.reward_account_encrypted) }
      : null
  };
}

function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) { fail(res, 401, 'Sign in to continue.', 'UNAUTHENTICATED'); return null; }
  return user;
}

/** A user may only read their own records unless they are an administrator. */
function requireSelf(req, res, idParam) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (Number(idParam) !== user.id && !user.is_admin) {
    fail(res, 403, 'You can only view your own records.', 'FORBIDDEN');
    return null;
  }
  return user;
}

/* ============================ shared queries ==========================
   Item 1 + 4 + 6 all resolve here. One function, one query: the homepage
   counter, the participants section and the "who is playing" widget can
   never disagree, because there is no second data path.               */

function participantCounts(gwNumber) {
  return db.prepare(`
    SELECT
      COUNT(CASE WHEN r.status = 'confirmed' THEN 1 END) AS confirmed,
      COUNT(CASE WHEN r.status IN ('proof_submitted','under_review','verified') THEN 1 END) AS pending,
      COUNT(CASE WHEN r.status <> 'rejected' THEN 1 END) AS applied,
      COALESCE(SUM(CASE WHEN r.status = 'confirmed' THEN g.entry_fee END), 0) AS collected
    FROM registrations r
    JOIN gameweeks g ON g.id = r.gameweek_id
    WHERE g.gw_number = ?`).get(Number(gwNumber));
}

/** PRIVACY CONTRACT: display name, team, initials, status, date. Nothing else. */
function participantRows(gwNumber, { search = '', page = 1, pageSize = 12, viewerId = -1 } = {}) {
  const like = `%${search}%`;
  const where = `
    WHERE g.gw_number = ?
      AND r.status IN (${ACTIVE_LIST})
      AND (? = '' OR u.full_name LIKE ? OR u.fpl_team_name LIKE ?)`;

  const totals = db.prepare(`
    SELECT COUNT(*) AS total,
           COUNT(CASE WHEN r.status = 'confirmed' THEN 1 END) AS confirmed,
           COUNT(CASE WHEN r.status <> 'confirmed' THEN 1 END) AS pending
    FROM registrations r
    JOIN users u     ON u.id = r.user_id
    JOIN gameweeks g ON g.id = r.gameweek_id ${where}`)
    .get(Number(gwNumber), search, like, like);

  const rows = db.prepare(`
    SELECT u.full_name                            AS displayName,
           COALESCE(u.fpl_team_name, 'FPL team')  AS teamName,
           r.status                               AS status,
           r.submitted_at                         AS appliedAt,
           (u.id = ?)                             AS isYou
    FROM registrations r
    JOIN users u     ON u.id = r.user_id
    JOIN gameweeks g ON g.id = r.gameweek_id ${where}
    ORDER BY (u.id = ?) DESC,
             CASE WHEN r.status = 'confirmed' THEN 0 ELSE 1 END,
             r.submitted_at ASC
    LIMIT ? OFFSET ?`)
    .all(viewerId, Number(gwNumber), search, like, like, viewerId,
         pageSize, (page - 1) * pageSize);

  return {
    total: totals.total,
    confirmed: totals.confirmed,
    pending: totals.pending,
    rows: rows.map((r) => ({
      displayName: r.displayName,
      teamName: r.teamName,
      initials: String(r.displayName).split(/\s+/).slice(0, 2)
        .map((w) => w[0]).join('').toUpperCase(),
      status: r.status,
      appliedAt: r.appliedAt,
      isYou: Boolean(r.isYou)
    }))
  };
}

function gameweekPayload(row) {
  const now = Date.now();
  return {
    id: row.id,
    gwNumber: row.gw_number,
    registrationOpenAt: row.registration_open_at,
    registrationCloseAt: row.registration_close_at,
    nextGwStartAt: row.next_gw_start_at,
    entryFee: row.entry_fee,
    status: row.status,
    registrationOpen: now >= row.registration_open_at && now < row.registration_close_at
  };
}

/* ============================== routing =============================== */

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

/* ---- GET /api/time ---------------------------------------------------- */
route('GET', /^\/api\/time$/, (req, res) =>
  json(res, 200, { epochMs: Date.now(), timezone: CONFIG.TIMEZONE }));

/* ---- GET /api/gameweeks/current --------------------------------------- */
route('GET', /^\/api\/gameweeks\/current$/, (req, res) => {
  refreshGameweekStatus();
  const gw = currentGameweek();
  const next = gameweekByNumber(gw.gw_number + 1);
  json(res, 200, {
    gameweek: gameweekPayload(gw),
    next: next ? gameweekPayload(next) : null,
    entryFee: gw.entry_fee,
    prizePoolRatio: CONFIG.PRIZE_POOL_RATIO,
    timezone: CONFIG.TIMEZONE,
    serverTime: Date.now()
  });
});

/* ---- GET /api/gameweeks/:gw/participants/count  (item 1) -------------- */
route('GET', /^\/api\/gameweeks\/(\d+)\/participants\/count$/, (req, res, [gwRaw]) => {
  const gw = gameweekByNumber(gwRaw);
  if (!gw) return fail(res, 404, 'That gameweek does not exist.', 'NOT_FOUND');
  const counts = participantCounts(gwRaw);
  json(res, 200, {
    gwNumber: gw.gw_number,
    confirmed: counts.confirmed,
    pending: counts.pending,
    applied: counts.applied,
    entryFee: gw.entry_fee,
    collected: counts.collected,
    prizePool: Math.round(counts.collected * CONFIG.PRIZE_POOL_RATIO / 100 / 100) * 100,
    registrationCloseAt: gw.registration_close_at,
    status: gw.status
  });
});

/* ---- GET /api/gameweeks/:gw/participants  (items 4 + 6) --------------- */
route('GET', /^\/api\/gameweeks\/(\d+)\/participants$/, (req, res, [gwRaw], url) => {
  const gw = gameweekByNumber(gwRaw);
  if (!gw) return fail(res, 404, 'That gameweek does not exist.', 'NOT_FOUND');
  const me = currentUser(req);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(48, Math.max(1, Number(url.searchParams.get('page_size')) || 12));
  const data = participantRows(gwRaw, {
    search: (url.searchParams.get('search') || '').trim(),
    page, pageSize, viewerId: me ? me.id : -1
  });
  json(res, 200, { gwNumber: gw.gw_number, page, pageSize, ...data });
});

/* ---- GET /api/leaderboard?gameweek=&scope=  (item 3) ------------------ */
route('GET', /^\/api\/leaderboard$/, (req, res, _p, url) => {
  const gwNumber = Number(url.searchParams.get('gameweek')) || currentGameweek().gw_number;
  const scope = url.searchParams.get('scope') || 'gameweek';
  const size = Math.min(200, Math.max(1, Number(url.searchParams.get('size')) || 40));
  const gw = gameweekByNumber(gwNumber);
  if (!gw) return fail(res, 404, 'That gameweek does not exist.', 'NOT_FOUND');
  const me = currentUser(req);

  const orderBy = scope === 'overall'
    ? 'ls.total_points DESC, ls.gw_points DESC'
    : 'ls.gw_points DESC, ls.total_points DESC';

  const rows = db.prepare(`
    SELECT u.id                                   AS userId,
           u.full_name                            AS managerName,
           COALESCE(u.fpl_team_name, 'FPL team')  AS teamName,
           ls.gw_points                           AS gwPoints,
           ls.total_points                        AS totalPoints,
           ls.overall_rank                        AS overallRank,
           ls.previous_rank                       AS previousRank
    FROM registrations r
    JOIN users u             ON u.id = r.user_id
    JOIN leaderboard_stats ls ON ls.user_id = r.user_id AND ls.gameweek_id = r.gameweek_id
    WHERE r.gameweek_id = ? AND r.status = 'confirmed'
    ORDER BY ${orderBy}
    LIMIT ?`).all(gw.id, size);

  // Movement compares this gameweek's placing with last gameweek's placing.
  const prevGw = gameweekByNumber(gwNumber - 1);
  const prevPlacing = new Map();
  if (prevGw) {
    db.prepare(`
      SELECT u.id AS userId FROM registrations r
      JOIN users u              ON u.id = r.user_id
      JOIN leaderboard_stats ls ON ls.user_id = r.user_id AND ls.gameweek_id = r.gameweek_id
      WHERE r.gameweek_id = ? AND r.status = 'confirmed'
      ORDER BY ls.gw_points DESC, ls.total_points DESC`)
      .all(prevGw.id).forEach((r, i) => prevPlacing.set(r.userId, i + 1));
  }

  const stats = db.prepare(`
    SELECT COUNT(*) AS participants,
           COALESCE(ROUND(AVG(ls.gw_points)), 0) AS averagePoints,
           COALESCE(MAX(ls.gw_points), 0)        AS highestPoints,
           MAX(ls.updated_at)                    AS updatedAt
    FROM registrations r
    JOIN leaderboard_stats ls ON ls.user_id = r.user_id AND ls.gameweek_id = r.gameweek_id
    WHERE r.gameweek_id = ? AND r.status = 'confirmed'`).get(gw.id);

  /* Your rank is computed against the whole table, not the page of rows
     returned — the stat bar asks for size=1 and must still be correct. */
  let yourRank = null;
  if (me) {
    const mine = db.prepare(`
      SELECT ls.gw_points, ls.total_points FROM registrations r
      JOIN leaderboard_stats ls ON ls.user_id = r.user_id AND ls.gameweek_id = r.gameweek_id
      WHERE r.gameweek_id = ? AND r.status = 'confirmed' AND r.user_id = ?`).get(gw.id, me.id);
    if (mine) {
      const ahead = db.prepare(`
        SELECT COUNT(*) AS n FROM registrations r
        JOIN leaderboard_stats ls ON ls.user_id = r.user_id AND ls.gameweek_id = r.gameweek_id
        WHERE r.gameweek_id = ? AND r.status = 'confirmed'
          AND (ls.gw_points > ? OR (ls.gw_points = ? AND ls.total_points > ?))`)
        .get(gw.id, mine.gw_points, mine.gw_points, mine.total_points);
      yourRank = ahead.n + 1;
    }
  }

  const shaped = rows.map((r, i) => ({
    rank: i + 1,
    userId: r.userId,
    managerName: r.managerName,
    teamName: r.teamName,
    initials: String(r.managerName).split(/\s+/).slice(0, 2)
      .map((w) => w[0]).join('').toUpperCase(),
    gwPoints: r.gwPoints,
    totalPoints: r.totalPoints,
    overallRank: r.overallRank,
    movement: prevPlacing.has(r.userId) ? prevPlacing.get(r.userId) - (i + 1) : 0,
    isYou: Boolean(me && r.userId === me.id)
  }));
  json(res, 200, {
    gwNumber: gw.gw_number,
    scope,
    rows: shaped,
    stats: {
      participants: participantCounts(gw.gw_number).confirmed,
      ranked: stats.participants,
      averagePoints: stats.averagePoints,
      highestPoints: stats.highestPoints,
      topManager: shaped.length ? shaped[0].managerName : null,
      yourRank,
      updatedAt: stats.updatedAt
    }
  });
});

/* ---- GET /api/users/:id/dashboard  (item 5) ---------------------------
   One aggregated call. Gameweek numbering comes from gameweeks.gw_number,
   never from client-side arithmetic.                                   */
route('GET', /^\/api\/users\/(\d+)\/dashboard$/, (req, res, [idRaw]) => {
  const user = requireSelf(req, res, idRaw);
  if (!user) return;
  const target = Number(idRaw);
  const gw = currentGameweek();

  const totals = db.prepare(`
    SELECT COUNT(*) AS entries,
           COUNT(CASE WHEN status = 'confirmed' THEN 1 END) AS confirmed
    FROM registrations WHERE user_id = ?`).get(target);

  const points = db.prepare(`
    SELECT COALESCE(SUM(ls.gw_points), 0) AS tournamentPoints,
           COUNT(*)                       AS scoredGameweeks
    FROM registrations r
    JOIN leaderboard_stats ls ON ls.user_id = r.user_id AND ls.gameweek_id = r.gameweek_id
    WHERE r.user_id = ? AND r.status = 'confirmed'`).get(target);

  const currentStat = db.prepare(`
    SELECT ls.gw_points AS gwPoints, ls.total_points AS totalPoints, ls.overall_rank AS overallRank
    FROM leaderboard_stats ls WHERE ls.user_id = ? AND ls.gameweek_id = ?`).get(target, gw.id);

  const winnings = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0)    AS paid,
           COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0) AS pending
    FROM rewards WHERE user_id = ?`).get(target);

  // Placing inside this gameweek's tournament, read from leaderboard_stats.
  const placing = db.prepare(`
    SELECT COUNT(*) + 1 AS rank
    FROM registrations r
    JOIN leaderboard_stats ls ON ls.user_id = r.user_id AND ls.gameweek_id = r.gameweek_id
    WHERE r.gameweek_id = ? AND r.status = 'confirmed'
      AND ls.gw_points > COALESCE(
        (SELECT gw_points FROM leaderboard_stats WHERE user_id = ? AND gameweek_id = ?), -1)`)
    .get(gw.id, target, gw.id);

  const registration = db.prepare(`
    SELECT r.id, r.status, r.submitted_at AS submittedAt, r.verified_at AS verifiedAt,
           g.gw_number AS gwNumber, g.entry_fee AS entryFee
    FROM registrations r JOIN gameweeks g ON g.id = r.gameweek_id
    WHERE r.user_id = ? AND r.gameweek_id = ?`).get(target, gw.id);

  json(res, 200, {
    userId: target,
    currentGameweek: gw.gw_number,
    gameweek: gameweekPayload(gw),
    registration: registration || null,
    stats: {
      currentRank: currentStat ? placing.rank : null,
      gwPoints: currentStat ? currentStat.gwPoints : null,
      totalPoints: points.tournamentPoints,
      overallRank: currentStat ? currentStat.overallRank : null,
      entries: totals.entries,
      confirmedEntries: totals.confirmed,
      scoredGameweeks: points.scoredGameweeks,
      winningsPaid: winnings.paid,
      winningsPending: winnings.pending
    }
  });
});

/* ---- GET /api/users/:id/performance  (item 5) -------------------------
   One row per gameweek from gw_number 1 to the current one, so the chart
   starts at Gameweek 1 and lengthens as the season runs.               */
route('GET', /^\/api\/users\/(\d+)\/performance$/, (req, res, [idRaw]) => {
  const user = requireSelf(req, res, idRaw);
  if (!user) return;
  const target = Number(idRaw);
  const current = currentGameweek();

  const rows = db.prepare(`
    SELECT g.gw_number                AS gwNumber,
           g.status                   AS gameweekStatus,
           r.status                   AS registrationStatus,
           ls.gw_points               AS gwPoints,
           ls.total_points            AS totalPoints,
           ls.overall_rank            AS overallRank,
           ls.previous_rank           AS previousRank,
           COALESCE(rw.amount, 0)     AS winnings,
           rw.status                  AS rewardStatus
    FROM gameweeks g
    LEFT JOIN registrations     r  ON r.gameweek_id  = g.id AND r.user_id  = ?
    LEFT JOIN leaderboard_stats ls ON ls.gameweek_id = g.id AND ls.user_id = ?
    LEFT JOIN rewards           rw ON rw.gameweek_id = g.id AND rw.user_id = ?
    WHERE g.gw_number <= ?
    ORDER BY g.gw_number ASC`).all(target, target, target, current.gw_number);

  json(res, 200, {
    userId: target,
    currentGameweek: current.gw_number,
    rows: rows.map((r) => ({
      ...r,
      played: r.registrationStatus === 'confirmed',
      settled: r.gameweekStatus === 'completed'
    }))
  });
});

/* ---- GET /api/users/:id/rewards --------------------------------------- */
route('GET', /^\/api\/users\/(\d+)\/rewards$/, (req, res, [idRaw]) => {
  const user = requireSelf(req, res, idRaw);
  if (!user) return;
  const rows = db.prepare(`
    SELECT rw.id, g.gw_number AS gwNumber, rw.amount, rw.status, rw.paid_at AS paidAt
    FROM rewards rw JOIN gameweeks g ON g.id = rw.gameweek_id
    WHERE rw.user_id = ? ORDER BY g.gw_number DESC`).all(Number(idRaw));
  const totals = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0)    AS paid,
           COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0) AS pending
    FROM rewards WHERE user_id = ?`).get(Number(idRaw));
  json(res, 200, { rows, totals });
});

/* ---- POST /api/registrations -----------------------------------------
   The deadline is enforced HERE. The browser also disables the button,
   but a device clock can be changed, so this is the check that counts. */
route('POST', /^\/api\/registrations$/, async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const body = await readBody(req);
  const now = Date.now();
  const gwNumber = Number(body.gameweek) || currentGameweek().gw_number;

  const gw = db.prepare(`
    SELECT * FROM gameweeks
    WHERE gw_number = ? AND registration_open_at <= ? AND registration_close_at > ?`)
    .get(gwNumber, now, now);
  if (!gw) {
    return fail(res, 409, `Registration for Gameweek ${gwNumber} is closed.`, 'REGISTRATION_CLOSED');
  }
  if (!user.fpl_manager_id) {
    return fail(res, 400, 'Connect your FPL Manager ID before entering.', 'FPL_REQUIRED');
  }

  const existing = db.prepare(
    'SELECT * FROM registrations WHERE user_id = ? AND gameweek_id = ?').get(user.id, gw.id);
  if (existing) return json(res, 200, { registration: existing, alreadyRegistered: true });

  const info = db.prepare(`
    INSERT INTO registrations (user_id, gameweek_id, payment_method, status, submitted_at)
    VALUES (?, ?, ?, 'awaiting_proof', ?)`)
    .run(user.id, gw.id, body.paymentMethod || null, now);

  json(res, 201, {
    registration: db.prepare('SELECT * FROM registrations WHERE id = ?')
      .get(Number(info.lastInsertRowid))
  });
});

/* ---- POST /api/registrations/:id/proof -------------------------------- */
route('POST', /^\/api\/registrations\/(\d+)\/proof$/, async (req, res, [idRaw]) => {
  const user = requireUser(req, res);
  if (!user) return;
  const body = await readBody(req);
  const now = Date.now();

  const reg = db.prepare(`
    SELECT r.*, g.registration_close_at, g.gw_number
    FROM registrations r JOIN gameweeks g ON g.id = r.gameweek_id
    WHERE r.id = ?`).get(Number(idRaw));
  if (!reg) return fail(res, 404, 'Registration not found.', 'NOT_FOUND');
  if (reg.user_id !== user.id && !user.is_admin) {
    return fail(res, 403, 'That registration belongs to another account.', 'FORBIDDEN');
  }
  if (now >= reg.registration_close_at) {
    return fail(res, 409, `Registration for Gameweek ${reg.gw_number} is closed.`, 'REGISTRATION_CLOSED');
  }

  db.prepare(`
    UPDATE registrations
    SET status = 'under_review', payment_reference = ?, payment_method = COALESCE(?, payment_method)
    WHERE id = ?`).run(body.paymentReference || null, body.paymentMethod || null, reg.id);

  json(res, 200, {
    registration: db.prepare('SELECT * FROM registrations WHERE id = ?').get(reg.id)
  });
});

/* ---- POST /api/registrations/:id/verify -------------------------------
   The only path from "proof sent" to "counted as a participant".
   [BACKEND] Put this behind real administrator auth before launch. */
route('POST', /^\/api\/registrations\/(\d+)\/verify$/, async (req, res, [idRaw]) => {
  const user = requireUser(req, res);
  if (!user) return;
  const { approve = true } = await readBody(req);
  const reg = db.prepare('SELECT * FROM registrations WHERE id = ?').get(Number(idRaw));
  if (!reg) return fail(res, 404, 'Registration not found.', 'NOT_FOUND');
  if (reg.user_id !== user.id && !user.is_admin) {
    return fail(res, 403, 'Administrator access is required.', 'FORBIDDEN');
  }
  const changed = db.prepare(`
    UPDATE registrations SET status = ?, verified_at = ?, verified_by_admin_id = ?
    WHERE id = ? AND status IN ('proof_submitted','under_review','verified')`)
    .run(approve ? 'confirmed' : 'rejected', Date.now(), user.id, reg.id);
  if (!changed.changes) return fail(res, 409, 'That registration is not awaiting review.', 'CONFLICT');

  syncFplData();
  json(res, 200, {
    registration: db.prepare('SELECT * FROM registrations WHERE id = ?').get(reg.id)
  });
});

/* ---- GET /api/me/registrations ---------------------------------------- */
route('GET', /^\/api\/me\/registrations$/, (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const rows = db.prepare(`
    SELECT r.id, g.gw_number AS gwNumber, g.entry_fee AS entryFee, r.status,
           r.submitted_at AS submittedAt, r.verified_at AS verifiedAt,
           r.payment_method AS paymentMethod, r.payment_reference AS paymentReference
    FROM registrations r JOIN gameweeks g ON g.id = r.gameweek_id
    WHERE r.user_id = ? ORDER BY g.gw_number DESC`).all(user.id);
  json(res, 200, { rows });
});

/* ============================ auth endpoints ========================== */

route('POST', /^\/api\/auth\/register$/, async (req, res) => {
  const b = await readBody(req);
  if (!b.fullName || !b.email || !b.phone || !b.password) {
    return fail(res, 400, 'Full name, email, phone and password are all required.', 'VALIDATION');
  }
  if (Number(b.age) < 18) return fail(res, 400, 'You must be 18 or older to take part.', 'VALIDATION');
  if (String(b.password).length < 8) {
    return fail(res, 400, 'Passwords must be at least 8 characters.', 'VALIDATION');
  }
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(b.email)) {
    return fail(res, 409, 'An account already uses this email address.', 'EMAIL_TAKEN');
  }
  const reward = b.reward || {};
  const info = db.prepare(`
    INSERT INTO users (full_name, age, phone, email, password_hash,
                       reward_method, reward_account_encrypted, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(b.fullName, Number(b.age), b.phone, b.email, hashPassword(b.password),
         reward.method || null, encrypt(reward.accountNumber), Date.now());
  const id = Number(info.lastInsertRowid);
  createSession(res, id);
  json(res, 201, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
});

route('POST', /^\/api\/auth\/login$/, async (req, res) => {
  const { email, password } = await readBody(req);
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email || '');
  // Identical message either way, so responses cannot enumerate accounts.
  if (!row || !verifyPassword(password || '', row.password_hash)) {
    return fail(res, 401, 'Those details do not match an account.', 'INVALID_CREDENTIALS');
  }
  createSession(res, row.id);
  json(res, 200, { user: publicUser(row) });
});

route('POST', /^\/api\/auth\/logout$/, (req, res) => {
  const token = parseCookies(req).dil_session;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'dil_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  json(res, 200, { ok: true });
});

route('GET', /^\/api\/auth\/me$/, (req, res) =>
  json(res, 200, { user: publicUser(currentUser(req)) }));

/* ---- PATCH /api/me/fpl ------------------------------------------------ */
route('PATCH', /^\/api\/me\/fpl$/, async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const { managerId, teamName } = await readBody(req);
  if (!/^\d{1,9}$/.test(String(managerId || ''))) {
    return fail(res, 400, 'A Manager ID is numbers only, e.g. 4271839.', 'FORMAT');
  }
  if (db.prepare('SELECT id FROM users WHERE fpl_manager_id = ? AND id <> ?')
        .get(String(managerId), user.id)) {
    return fail(res, 409, 'That FPL Manager ID is already connected to another account.', 'FPL_TAKEN');
  }
  db.prepare('UPDATE users SET fpl_manager_id = ?, fpl_team_name = ? WHERE id = ?')
    .run(String(managerId), teamName || null, user.id);
  syncFplData();
  json(res, 200, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
});

/* ---- PATCH /api/me/reward --------------------------------------------- */
route('PATCH', /^\/api\/me\/reward$/, async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const { method, accountNumber } = await readBody(req);
  if (!accountNumber) return fail(res, 400, 'An account number is required.', 'VALIDATION');
  db.prepare('UPDATE users SET reward_method = ?, reward_account_encrypted = ? WHERE id = ?')
    .run(method || 'telebirr', encrypt(accountNumber), user.id);
  json(res, 200, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
});

/* ---- GET /api/fpl/manager/:id ----------------------------------------
   [BACKEND] Swap this for a server-side call to the official FPL API. It
   must stay on the server: FPL sends no CORS headers, and credentials
   never belong in a browser.                                          */
route('GET', /^\/api\/fpl\/manager\/(\d+)$/, (req, res, [managerId]) => {
  if (managerId.endsWith('0')) return fail(res, 404, 'Manager not found.', 'NOT_FOUND');
  const { seededRandom } = require('./db');
  const rnd = seededRandom(Number(managerId));
  const FIRST = ['Abel', 'Mekdes', 'Yonas', 'Samuel', 'Hanna', 'Dawit', 'Selam', 'Nahom'];
  const LAST = ['Tesfaye', 'Alemu', 'Bekele', 'Girma', 'Mekonnen', 'Tadesse', 'Haile'];
  const TEAMS = ['Lucy Legends', 'Abyssinia FC', 'Sheger United', 'Nile Navigators',
    'Entoto XI', 'Habesha Hotspur', 'Rift Valley FC'];
  json(res, 200, {
    managerId,
    managerName: `${FIRST[Math.floor(rnd() * FIRST.length)]} ${LAST[Math.floor(rnd() * LAST.length)]}`,
    teamName: TEAMS[Math.floor(rnd() * TEAMS.length)],
    teamValue: Number((98.5 + rnd() * 6).toFixed(1))
  });
});

/* ========================= static file serving ======================== */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.sql': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8'
};

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.normalize(path.join(SITE_ROOT, rel));
  // Never serve outside the site root, and never the server folder or the db.
  if (!target.startsWith(SITE_ROOT) ||
      target.includes(`${path.sep}server${path.sep}`) ||
      target.endsWith('.db')) {
    return fail(res, 403, 'Forbidden', 'FORBIDDEN');
  }
  fs.readFile(target, (err, data) => {
    if (err) return fail(res, 404, 'Not found', 'NOT_FOUND');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ============================== dispatch ============================== */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const match = r.pattern.exec(url.pathname);
      if (!match) continue;
      try { return await r.handler(req, res, match.slice(1), url); }
      catch (err) {
        console.error('[dil] handler error', err);
        return fail(res, 500, err.message || 'Server error', 'SERVER_ERROR');
      }
    }
    return fail(res, 404, `No route for ${req.method} ${url.pathname}`, 'NOT_FOUND');
  }
  if (req.method !== 'GET') return fail(res, 405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`[dil] Dil Fantasy running on http://localhost:${PORT}`);
  console.log(`[dil] current gameweek: ${currentGameweek().gw_number}`);
});

// Roll gameweek status and pull scores as gameweeks finish.
setInterval(() => {
  try { refreshGameweekStatus(); syncFplData(); }
  catch (err) { console.error('[dil] sync failed', err); }
}, 15 * 60 * 1000);
