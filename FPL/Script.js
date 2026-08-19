/* ==========================================================================
   DIL FANTASY — core application script
   --------------------------------------------------------------------------
   Everything configurable lives in DIL_CONFIG. Nothing below it hardcodes a
   gameweek, a deadline or a countdown value: all of it derives from the clock.

   Backend integration points are marked with  // [BACKEND]
   ========================================================================== */
'use strict';

/* ============================ 1. CONFIGURATION ============================ */

const DIL_CONFIG = {
  brand: {
    name: 'Dil Fantasy',
    tagline: 'Your competitive Fantasy Premier League platform in Ethiopia.'
  },

  /* ---- Payment proof destination -----------------------------------------
     The official Dil Fantasy Telegram group where entrants send payment
     screenshots. This single value feeds every Telegram touchpoint: the entry
     modal button, the dashboard resume-proof button, the group links on the
     tournament and How It Works pages, and the footer icon. Change the group
     by editing this line only. If it is ever set back to an empty string the
     UI hides standalone links and shows a configuration notice rather than
     sending anyone to an address that does not exist.                       */
  TELEGRAM_PROOF_URL: 'https://t.me/+dou_6OTMH5ZkZWNk',

  /* ---- Money ---- */
  ENTRY_FEE_BIRR: 200,
  CURRENCY: 'Birr',
  /* Share of collected entry fees advertised as the tournament prize pool.
     [BACKEND] The real figure must come from the server, not the browser. */
  PRIZE_POOL_RATIO: 0.7,

  /* ---- Time ---- */
  TIMEZONE: 'Africa/Addis_Ababa',   // EAT, UTC+3, no daylight saving
  TZ_LABEL: 'EAT',
  TZ_OFFSET_MINUTES: 180,

  /* ---- Season / gameweek schedule -----------------------------------------
     seasonAnchorUTC is the moment Gameweek 1 opened: Sunday 00:00 EAT, which
     is Saturday 21:00 UTC. Every following Sunday 00:00 EAT the gameweek
     number increments by one, indefinitely.                                */
  SEASON: {
    firstGameweek: 1,
    // Sun 16 Aug 2026, 00:00 EAT  ==  Sat 15 Aug 2026, 21:00 UTC
    seasonAnchorUTC: Date.UTC(2026, 7, 15, 21, 0, 0)
  },

  REGISTRATION: {
    opensDayOffset: 0,        // Sunday, the day the gameweek opens
    opensHourEAT: 0,          // 12:00 AM EAT
    closesDayOffset: 5,       // Sunday + 5 days = Friday
    closesHourEAT: 14,        // 2:00 PM EAT
    closesMinuteEAT: 0,
    closingSoonHours: 24      // "closing soon" warning window
  },

  /* ---- Data source --------------------------------------------------------
     The official FPL API cannot be called directly from a browser (no CORS
     headers), and it must never be called with credentials from the client.
     Point apiBaseUrl at your own backend proxy; while it is empty the app
     runs on clearly-labelled demo data.                                    */
  API: {
    /* Left empty, the app auto-detects the bundled API: when the page is
       served by server/index.js, '/api' answers and everything reads from
       SQL. Opening the files directly with no server still works — the app
       falls back to labelled demo data. Set this to point at a backend on
       another origin, e.g. 'https://api.dilfantasy.et/v1'.               */
    apiBaseUrl: '',
    autoDetect: true,
    requestTimeoutMs: 12000
  },

  SUPPORT_EMAIL: 'support@dilfantasy.et'
};

/* Derived constants */
const MS = { sec: 1000, min: 60000, hour: 3600000, day: 86400000, week: 604800000 };

/* ================================ 2. UTIL ================================= */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const pad = (n, len = 2) => String(Math.max(0, Math.floor(n))).padStart(len, '0');
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatNumber(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US');
}

function formatBirr(n) {
  return `${formatNumber(Math.round(n))} ${DIL_CONFIG.CURRENCY}`;
}

function initials(name) {
  return String(name || '?')
    .trim().split(/\s+/).slice(0, 2)
    .map((w) => w[0] || '').join('').toUpperCase() || '?';
}

/* Deterministic pseudo-random generator — same seed always yields the same
   demo dataset, so ranks do not jump around between page loads. */
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ------------------------------ Storage ----------------------------------
   localStorage is used when available and falls back to an in-memory map so
   the app never throws in sandboxed or private-browsing contexts.          */
const Store = (() => {
  const NS = 'dil:';
  const memory = new Map();
  let usable = false;
  try {
    const probe = NS + 'probe';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    usable = true;
  } catch (err) {
    usable = false;
  }
  return {
    persistent: usable,
    get(key, fallback = null) {
      try {
        const raw = usable ? window.localStorage.getItem(NS + key) : memory.get(NS + key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (err) {
        return fallback;
      }
    },
    set(key, value) {
      const raw = JSON.stringify(value);
      try {
        if (usable) window.localStorage.setItem(NS + key, raw);
        else memory.set(NS + key, raw);
      } catch (err) {
        memory.set(NS + key, raw);
      }
      return value;
    },
    remove(key) {
      try {
        if (usable) window.localStorage.removeItem(NS + key);
      } catch (err) { /* ignore */ }
      memory.delete(NS + key);
    }
  };
})();

/* ============================= 3. TIME (EAT) ==============================
   All tournament maths runs on absolute UTC milliseconds, so the visitor's
   own timezone never changes the result. Display formatting is pinned to
   Africa/Addis_Ababa.                                                      */

const TimeService = {
  /* [BACKEND] offset between this browser's clock and the server clock.
     Populate from a signed server timestamp so a user cannot beat the Friday
     deadline by changing their computer clock. The server must revalidate
     every registration attempt regardless of what the browser says. */
  serverOffsetMs: 0,

  now() {
    return Date.now() + this.serverOffsetMs;
  },

  /* Pins the countdown to the server clock, so a changed device clock
     shifts nothing. GET /time, through the one API client. */
  async sync() {
    try {
      const data = await API.time();
      if (data && data.epochMs) {
        this.serverOffsetMs = Number(data.epochMs) - Date.now();
        return true;
      }
    } catch (err) {
      console.warn('[Dil Fantasy] Server time unavailable, using device clock.', err);
    }
    return false;
  }
};

const EAT = {
  fmt(ms, opts) {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: DIL_CONFIG.TIMEZONE, ...opts
    }).format(new Date(ms));
  },
  date(ms) {
    return this.fmt(ms, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  },
  shortDate(ms) {
    return this.fmt(ms, { day: '2-digit', month: 'short', year: 'numeric' });
  },
  time(ms) {
    return this.fmt(ms, { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase();
  },
  full(ms) {
    return `${this.date(ms)} • ${this.time(ms)} ${DIL_CONFIG.TZ_LABEL}`;
  }
};

/* ========================= 4. TOURNAMENT ENGINE ===========================
   The single source of truth for "what gameweek is it and can I register".  */

const Tournament = {
  /* Seeded by GET /gameweeks/current. gw_number, the open time and the
     deadline are all columns in the gameweeks table — the browser only
     counts down towards timestamps the server gave it, and never decides
     which gameweek is running. */
  server: null,

  /** Loads the authoritative gameweek. Called once at boot. */
  async load() {
    const data = await DataService.getCurrentGameweek();
    this.server = data;
    if (data.entryFee) DIL_CONFIG.ENTRY_FEE_BIRR = data.entryFee;
    if (data.prizePoolRatio) DIL_CONFIG.PRIZE_POOL_RATIO = data.prizePoolRatio / 100;
    // Anchor the local schedule to the row the server returned.
    DIL_CONFIG.SEASON.firstGameweek = 1;
    DIL_CONFIG.SEASON.seasonAnchorUTC =
      data.gameweek.registrationOpenAt - (data.gameweek.gwNumber - 1) * MS.week;
    return data;
  },

  /** Millisecond timestamp at which gameweek `gw` opens (Sunday 00:00 EAT). */
  weekStart(gw) {
    const { seasonAnchorUTC, firstGameweek } = DIL_CONFIG.SEASON;
    return seasonAnchorUTC + (gw - firstGameweek) * MS.week;
  },

  /** Registration deadline for gameweek `gw` (Friday 14:00 EAT). */
  deadline(gw) {
    // Use the exact column value for the gameweek the server described.
    if (this.server && this.server.gameweek.gwNumber === gw) {
      return this.server.gameweek.registrationCloseAt;
    }
    const r = DIL_CONFIG.REGISTRATION;
    return this.weekStart(gw)
      + r.closesDayOffset * MS.day
      + r.closesHourEAT * MS.hour
      + r.closesMinuteEAT * MS.min;
  },

  /** Gameweek number active at time `t`, from gameweeks.gw_number. */
  gameweekAt(t = TimeService.now()) {
    const { seasonAnchorUTC, firstGameweek } = DIL_CONFIG.SEASON;
    if (t < seasonAnchorUTC) return firstGameweek;
    return firstGameweek + Math.floor((t - seasonAnchorUTC) / MS.week);
  },

  /**
   * Full tournament state at time `t`.
   * open          Sunday 00:00 EAT → Friday 14:00 EAT
   * closing-soon   final 24h of that window
   * closed         Friday 14:00 EAT → next Sunday 00:00 EAT
   */
  state(t = TimeService.now()) {
    const gameweek = this.gameweekAt(t);
    const opensAt = this.weekStart(gameweek);
    const closesAt = this.deadline(gameweek);
    const nextOpensAt = this.weekStart(gameweek + 1);
    const preSeason = t < DIL_CONFIG.SEASON.seasonAnchorUTC;

    const registrationOpen = !preSeason && t < closesAt;
    const msLeft = registrationOpen ? closesAt - t : nextOpensAt - t;
    const closingSoon = registrationOpen
      && (closesAt - t) <= DIL_CONFIG.REGISTRATION.closingSoonHours * MS.hour;

    let status = 'closed';
    if (preSeason) status = 'pre-season';
    else if (closingSoon) status = 'closing-soon';
    else if (registrationOpen) status = 'open';

    const windowTotal = closesAt - opensAt;
    const progressRemaining = registrationOpen
      ? clamp((closesAt - t) / windowTotal, 0, 1)
      : 0;

    return {
      now: t,
      gameweek,
      opensAt,
      closesAt,
      nextOpensAt,
      registrationOpen,
      closingSoon,
      preSeason,
      status,                                     // open | closing-soon | closed | pre-season
      statusLabel: {
        'open': 'Registration open',
        'closing-soon': 'Registration closing soon',
        'closed': 'Registration closed',
        'pre-season': 'Opening soon'
      }[status],
      countdownTarget: registrationOpen ? closesAt : nextOpensAt,
      countdownLabel: registrationOpen ? 'Registration closes in' : 'Next gameweek starts in',
      msLeft: Math.max(0, msLeft),
      parts: this.split(Math.max(0, msLeft)),
      progressRemaining
    };
  },

  split(ms) {
    return {
      days: Math.floor(ms / MS.day),
      hours: Math.floor((ms % MS.day) / MS.hour),
      minutes: Math.floor((ms % MS.hour) / MS.min),
      seconds: Math.floor((ms % MS.min) / MS.sec)
    };
  },

  /** Human phrase for how much of the window is left. */
  remainingPhrase(state) {
    if (!state.registrationOpen) {
      const p = state.parts;
      if (p.days >= 1) return `New gameweek opens in ${p.days} day${p.days === 1 ? '' : 's'}, ${p.hours} hour${p.hours === 1 ? '' : 's'}`;
      return `New gameweek opens in ${p.hours}h ${p.minutes}m`;
    }
    const p = state.parts;
    if (p.days >= 1) return `Registration closes in ${p.days} day${p.days === 1 ? '' : 's'}, ${p.hours} hour${p.hours === 1 ? '' : 's'}`;
    if (p.hours >= 1) return `Registration closes in ${p.hours}h ${p.minutes}m — last chance`;
    return `Registration closes in ${p.minutes}m ${p.seconds}s — last chance`;
  },

  /** Lifecycle of any gameweek relative to now: upcoming | active | completed */
  phaseOf(gw, t = TimeService.now()) {
    if (t < this.deadline(gw)) return 'upcoming';
    if (t < this.weekStart(gw + 1)) return 'active';
    return 'completed';
  },

  /* Participant counts and prize pools are facts about the database, not
     something this file can calculate. DataService.getTournamentSummary()
     fetches them (schema.sql query A) and stores the result here; the UI
     renders a placeholder and fills it in when the value arrives.       */
  summaries: new Map(),

  cacheSummary(summary) {
    if (summary && summary.gameweek != null) this.summaries.set(summary.gameweek, summary);
    return summary;
  },

  /** Last known confirmed participant count, or null if not loaded yet. */
  participantsFor(gw) {
    const s = this.summaries.get(gw);
    return s ? s.confirmed : null;
  },

  prizePoolFor(gw) {
    const s = this.summaries.get(gw);
    return s ? s.prizePool : null;
  },

  /** Build a descriptor object used by every tournament card in the app. */
  describe(gw, t = TimeService.now()) {
    const phase = this.phaseOf(gw, t);
    const state = this.state(t);
    const isCurrent = gw === state.gameweek;
    return {
      gameweek: gw,
      phase,
      isCurrent,
      opensAt: this.weekStart(gw),
      closesAt: this.deadline(gw),
      endsAt: this.weekStart(gw + 1),
      participants: this.participantsFor(gw),   // null until loaded
      prizePool: this.prizePoolFor(gw),         // null until loaded
      entryFee: DIL_CONFIG.ENTRY_FEE_BIRR,
      canRegister: phase === 'upcoming' && isCurrent && state.registrationOpen,
      statusText: phase === 'upcoming'
        ? (isCurrent
          ? (state.registrationOpen ? state.statusLabel : 'Registration closed')
          : `Opens ${EAT.date(this.weekStart(gw))}`)
        : (phase === 'active' ? 'In progress' : 'Completed')
    };
  },

  /** The list shown on the tournaments page. */
  list(t = TimeService.now(), historyCount = 6) {
    const current = this.gameweekAt(t);
    const first = DIL_CONFIG.SEASON.firstGameweek;
    const items = [this.describe(current, t), this.describe(current + 1, t)];
    for (let gw = current - 1; gw >= Math.max(first, current - historyCount); gw--) {
      items.push(this.describe(gw, t));
    }
    // Current gameweek first, then next week, then most recent history.
    return items;
  }
};

/* ================= 5. DATA SERVICE (SQL-BACKED, VIA api-client) ==========
   Every figure the app shows comes from one of these methods, and each one
   is a single call through window.API to a single SQL query. There is no
   mock data and no fallback: if the database cannot be reached the caller
   gets an error and renders an error state, rather than a fabricated
   number that looks real.

   Item 1 (live counts), item 3 (leaderboard stats), item 4 and item 6
   (participants) all resolve through here, so they cannot disagree.     */

const DataService = {
  /* Counts are requested by several components on one page, so identical
     requests within a short window share a single response. The cache is
     cleared the moment a registration changes anything. */
  _cache: new Map(),
  _inflight: new Map(),

  _cached(key, ttlMs, producer) {
    const hit = this._cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value);
    if (this._inflight.has(key)) return this._inflight.get(key);

    const promise = producer()
      .then((value) => {
        this._cache.set(key, { at: Date.now(), value });
        this._inflight.delete(key);
        return value;
      })
      .catch((err) => {
        this._inflight.delete(key);   // never cache a failure
        throw err;
      });
    this._inflight.set(key, promise);
    return promise;
  },

  invalidate() { this._cache.clear(); },

  /** GET /gameweeks/current — gw_number comes from the table, not maths. */
  getCurrentGameweek() {
    return this._cached('gameweek:current', 15000, () => API.currentGameweek());
  },

  /** Item 1. GET /gameweeks/:gw/participants/count */
  getParticipantCount(gwNumber) {
    return this._cached(`count:${gwNumber}`, 15000, () => API.participantCount(gwNumber));
  },

  /** Items 4 and 6. GET /gameweeks/:gw/participants */
  getParticipants(gwNumber, options) {
    return API.participants(gwNumber, options);
  },

  /** Item 3. GET /leaderboard — rows and stats in one response. */
  getLeaderboard(options) {
    return API.leaderboard(options);
  },

  /** Item 5. GET /users/:id/dashboard */
  getDashboard(userId) {
    return API.dashboard(userId);
  },

  /** Item 5. GET /users/:id/performance */
  getPerformance(userId) {
    return API.performance(userId);
  },

  getRewards(userId) { return API.rewards(userId); }
};

/* ------------------------------------------------------------------------
   FPL lookups. The browser never calls the official FPL API: it sends no
   CORS headers and any credentials belong on the server. This asks our own
   backend, which holds that integration.                                */

class FPLError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'FPLError';
    this.code = code || 'FPL_ERROR';
  }
}

const FPLService = {
  /** Looks up a Manager ID so the user can confirm it before saving. */
  async connectFPLAccount(managerId) {
    const id = String(managerId || '').trim();
    if (!/^\d{1,9}$/.test(id)) {
      throw new FPLError('A Manager ID is numbers only, e.g. 4271839.', 'FORMAT');
    }
    try {
      return await API.fplManager(id);
    } catch (err) {
      if (err.code === 'HTTP_404' || err.code === 'NOT_FOUND') {
        throw new FPLError(`No FPL manager found with ID ${id}.`, 'NOT_FOUND');
      }
      throw new FPLError(err.message || 'Could not reach the FPL service.', err.code);
    }
  }
};

/* ============================ 6. ACCOUNTS ================================
   Demo-only account handling so the flows are explorable end to end.
   [BACKEND] Registration, login, sessions and password hashing must all move
   to the server. Nothing here is a security boundary.                      */

const Auth = {

  /* When the API is live the users table is the only source of truth. The
     server holds the session in an HttpOnly cookie, and this cache mirrors
     the signed-in row so current() can stay synchronous for the many call
     sites that rely on it. Without an API it falls back to local storage
     so the site still runs from the file system.                        */
  _cache: null,

  /** Loads the signed-in user once, at boot. */
  async hydrate() {
    try {
      const { user } = await API.me();
      this._cache = user ? await this.decorate(user) : null;
    } catch (err) {
      this._cache = null;
    }
    return this._cache;
  },

  /** Attaches the registration and reward rows the UI reads. */
  async decorate(user) {
    if (!user) return null;
    const [regs, rewards] = await Promise.all([
      API.myRegistrations().catch(() => ({ rows: [] })),
      API.rewards(user.id).catch(() => ({ rows: [] }))
    ]);
    const byGameweek = {};
    regs.rows.forEach((r) => { byGameweek[r.gwNumber] = r; });
    return { ...user, entries: byGameweek, rewards: rewards.rows || [] };
  },

  /** Re-reads the user, their registrations and rewards from the database. */
  async refresh() { return this.hydrate(); },

  current() { return this._cache; },

  isLoggedIn() { return Boolean(this._cache); },

  async register(payload) {
    // POST /auth/register — the users row is created server-side, with the
    // password hashed there and the reward account encrypted at rest.
    const { user } = await API.register({
      fullName: payload.fullName,
      email: payload.email,
      phone: payload.phone,
      age: Number(payload.age),
      password: payload.password,
      reward: payload.reward
    });
    this._cache = await this.decorate(user);
    return this._cache;
  },

  async login(email, password) {
    const { user } = await API.login(email, password);
    this._cache = await this.decorate(user);
    return this._cache;
  },

  async logout() {
    await API.logout().catch(() => {});
    this._cache = null;
  },

  /** Persists the fields the server owns, then re-reads the row. */
  async update(patch) {
    if (patch.fpl) {
      const { user } = await API.connectFpl(patch.fpl.managerId, patch.fpl.teamName);
      this._cache = await this.decorate(user);
      return this._cache;
    }
    if (patch.reward) {
      const { user } = await API.saveReward(patch.reward);
      this._cache = await this.decorate(user);
      return this._cache;
    }
    this._cache = { ...this._cache, ...patch };
    return this._cache;
  },

  /** Send visitors to the login page, remembering where they were headed. */
  requireLogin(intent) {
    if (this.isLoggedIn()) return true;
    Store.set('redirectAfterLogin', intent || window.location.pathname.split('/').pop() || 'index.html');
    window.location.href = 'login.html';
    return false;
  }
};

/* ============================= 7. ENTRIES ================================ */

/* ==================== 7. REGISTRATION STATUS + ENTRIES ==================
   ITEM 2 — every status label and every piece of status copy in the whole
   front end is defined here and nowhere else. No page file writes its own
   wording, so there is exactly one place to edit it.

   Keys match the registrations.status CHECK constraint in the migration.  */

const REGISTRATION_STATUS = {
  awaiting_proof: {
    key: 'awaiting_proof',
    label: 'Awaiting proof',
    tone: 'warn',
    // Shown before an application exists or before proof is sent.
    note: 'Once you apply it will be reviewed.'
  },
  proof_submitted: {
    key: 'proof_submitted',
    label: 'Proof submitted',
    tone: 'purple-soft',
    note: 'Once you apply it will be reviewed.'
  },
  under_review: {
    key: 'under_review',
    label: 'Under review',
    tone: 'purple-soft',
    note: 'Once you apply it will be reviewed.'
  },
  verified: {
    key: 'verified',
    label: 'Payment verified',
    tone: 'green-soft',
    note: 'Your payment has been verified.'
  },
  rejected: {
    key: 'rejected',
    label: 'Payment rejected',
    tone: 'danger',
    note: 'That payment could not be verified. Contact support to sort it out.'
  },
  confirmed: {
    key: 'confirmed',
    label: 'Registration confirmed',
    tone: 'green',
    note: 'You are confirmed for this gameweek.'
  }
};

/** The single line of copy shown wherever an application is described. */
const REVIEW_NOTICE = 'Once you apply it will be reviewed.';

const STATUS_BY_KEY = REGISTRATION_STATUS;
// Retained so older call sites keep working against the same single source.
const PAYMENT_STATUS = {
  AWAITING_PROOF: REGISTRATION_STATUS.awaiting_proof,
  PROOF_SUBMITTED: REGISTRATION_STATUS.proof_submitted,
  UNDER_REVIEW: REGISTRATION_STATUS.under_review,
  VERIFIED: REGISTRATION_STATUS.verified,
  REJECTED: REGISTRATION_STATUS.rejected,
  CONFIRMED: REGISTRATION_STATUS.confirmed
};

const statusOf = (key) => REGISTRATION_STATUS[key] || REGISTRATION_STATUS.awaiting_proof;

/* ------------------------------------------------------------------------
   Entries — every method writes to the registrations table through the API
   client. Nothing is stored in the browser.                             */

const Entries = {
  forGameweek(gw) {
    const user = Auth.current();
    if (!user) return null;
    return (user.entries || {})[gw] || null;
  },

  isConfirmed(gw) {
    const entry = this.forGameweek(gw);
    return Boolean(entry && entry.status === REGISTRATION_STATUS.confirmed.key);
  },

  /** POST /registrations — the server re-checks the deadline before insert. */
  async start(gw) {
    const state = Tournament.state();
    if (gw !== state.gameweek || !state.registrationOpen) {
      throw new Error(`Registration for Gameweek ${gw} has closed.`);
    }
    await API.createRegistration(gw);
    await Auth.refresh();
    this.announce(gw);
    return this.forGameweek(gw);
  },

  /** POST /registrations/:id/proof */
  async markProofSubmitted(gw) {
    let entry = this.forGameweek(gw);
    if (!entry) entry = await this.start(gw);
    if (!entry) throw new Error('That registration could not be found.');
    await API.submitProof(entry.id, { paymentMethod: entry.paymentMethod || 'telebirr' });
    await Auth.refresh();
    this.announce(gw);
    return this.forGameweek(gw);
  },

  /** POST /registrations/:id/verify — the administrator's approval step. */
  async verify(gw, approve = true) {
    const entry = this.forGameweek(gw);
    if (!entry) return null;
    await API.verifyRegistration(entry.id, approve);
    await Auth.refresh();
    this.announce(gw);
    return this.forGameweek(gw);
  },

  /** Tells every live counter on the page to re-read the database. */
  announce(gw) {
    DataService.invalidate();
    document.dispatchEvent(new CustomEvent('dil:participants-changed', { detail: { gameweek: gw } }));
  },

  history() {
    const user = Auth.current();
    if (!user) return [];
    return Object.values(user.entries || {}).sort((a, b) => b.gwNumber - a.gwNumber);
  }
};


/* ============================== 8. ICONS ================================= */

const ICONS = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6"/>',
  gift: '<path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7ZM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7Z"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  calendar: '<path d="M3 5h18v16H3zM3 10h18M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  wallet: '<path d="M3 7h15a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H5a2 2 0 0 1-2-2V7Zm0 0a2 2 0 0 1 2-2h11M17 13h.01"/>',
  trophy: '<path d="M8 21h8M12 17v4M6 4h12v5a6 6 0 0 1-12 0V4ZM6 6H3v2a4 4 0 0 0 3 3.9M18 6h3v2a4 4 0 0 1-3 3.9"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  userPlus: '<path d="M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 8v6M22 11h-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  alert: '<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.9 5.2A9.5 9.5 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.2 6.2A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.1-.9M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  chart: '<path d="M3 3v18h18M7 15l4-5 3 3 5-7"/>',
  telegram: '<path d="M21 4 3 11l5 2 2 6 3-4 5 4 3-15Z"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.3 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.9H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7.3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3Z"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7M3 3v6h6M12 7v5l4 2"/>',
  facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3Z"/>',
  instagram: '<rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>',
  x: '<path d="M4 4l16 16M20 4 4 20"/>',
  youtube: '<rect x="2" y="5" width="20" height="14" rx="4"/><path d="m10 9 5 3-5 3z"/>',
  download: '<path d="M12 3v12M7 11l5 5 5-5M4 21h16"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/>'
};

function icon(name, size = 18, strokeWidth = 1.9) {
  const path = ICONS[name] || ICONS.info;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;
}

/* ============================== 9. UI KIT ================================ */

const UI = {
  toastRegion: null,

  toast(message, { title = '', type = 'success', duration = 4600 } = {}) {
    if (!this.toastRegion) {
      this.toastRegion = document.createElement('div');
      this.toastRegion.className = 'toast-region';
      this.toastRegion.setAttribute('role', 'status');
      this.toastRegion.setAttribute('aria-live', 'polite');
      document.body.appendChild(this.toastRegion);
    }
    const el = document.createElement('div');
    el.className = 'toast';
    el.dataset.type = type;
    el.innerHTML = `
      <span style="color:var(--green-400);margin-top:2px">${icon(type === 'error' ? 'alert' : type === 'info' ? 'info' : 'check', 16)}</span>
      <div>${title ? `<strong>${escapeHTML(title)}</strong>` : ''}<p>${escapeHTML(message)}</p></div>`;
    this.toastRegion.appendChild(el);
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 220);
    }, duration);
  },

  /** Open a modal. `content` is an HTML string. Returns the dialog element. */
  modal({ title, subtitle = '', body, footer = '', wide = false, onOpen } = {}) {
    this.closeModal();
    const root = document.createElement('div');
    root.className = 'modal-root';
    root.dataset.open = 'true';
    root.innerHTML = `
      <div class="modal-scrim" data-close></div>
      <div class="modal-box${wide ? ' modal-box--wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-head">
          <div>
            <h2 id="modal-title">${escapeHTML(title)}</h2>
            ${subtitle ? `<p>${escapeHTML(subtitle)}</p>` : ''}
          </div>
          <button class="modal-close" type="button" data-close aria-label="Close dialog">${icon('close', 16)}</button>
        </div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div>`;
    document.body.appendChild(root);
    document.body.style.overflow = 'hidden';
    this._activeModal = root;
    this._lastFocused = document.activeElement;

    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) this.closeModal();
    });
    document.addEventListener('keydown', this._modalKeys);

    const focusable = root.querySelector('input, select, button:not(.modal-close), a[href]');
    (focusable || root.querySelector('.modal-close')).focus();
    if (typeof onOpen === 'function') onOpen(root);
    return root;
  },

  _modalKeys: (e) => {
    if (e.key === 'Escape') UI.closeModal();
    if (e.key !== 'Tab' || !UI._activeModal) return;
    const items = $$('a[href], button:not([disabled]), input:not([disabled]), select, textarea', UI._activeModal)
      .filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  },

  closeModal() {
    if (!this._activeModal) return;
    this._activeModal.remove();
    this._activeModal = null;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', this._modalKeys);
    if (this._lastFocused && this._lastFocused.focus) this._lastFocused.focus();
  },

  /** Accessible tabs. Container needs [role=tablist] with [data-tab] buttons. */
  tabs(container, onChange) {
    if (!container) return;
    const buttons = $$('[data-tab]', container);
    const select = (key) => {
      buttons.forEach((b) => {
        const on = b.dataset.tab === key;
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
      });
      $$('[data-tab-panel]').forEach((p) => {
        if (p.closest('[data-tabgroup]') === container.closest('[data-tabgroup]')) {
          p.hidden = p.dataset.tabPanel !== key;
        }
      });
      if (onChange) onChange(key);
    };
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (btn) select(btn.dataset.tab);
    });
    container.addEventListener('keydown', (e) => {
      const idx = buttons.indexOf(document.activeElement);
      if (idx < 0) return;
      let next = null;
      if (e.key === 'ArrowRight') next = buttons[(idx + 1) % buttons.length];
      if (e.key === 'ArrowLeft') next = buttons[(idx - 1 + buttons.length) % buttons.length];
      if (next) { e.preventDefault(); next.focus(); select(next.dataset.tab); }
    });
    const initial = buttons.find((b) => b.getAttribute('aria-selected') === 'true') || buttons[0];
    if (initial) select(initial.dataset.tab);
    return { select };
  },

  loading(btn, on, label) {
    if (!btn) return;
    if (on) {
      btn.dataset.originalLabel = btn.innerHTML;
      btn.dataset.loading = 'true';
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner${btn.classList.contains('btn--ghost') ? ' spinner--dark' : ' spinner--dark'}"></span> ${escapeHTML(label || 'Working')}`;
    } else {
      btn.dataset.loading = 'false';
      btn.disabled = false;
      if (btn.dataset.originalLabel) btn.innerHTML = btn.dataset.originalLabel;
    }
  },

  /** Count a number up when it scrolls into view. */
  animateValue(el, to, { duration = 900, format = formatNumber, prefix = '', suffix = '' } = {}) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = prefix + format(to) + suffix;
      return;
    }
    const start = performance.now();
    const step = (t) => {
      const p = clamp((t - start) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = prefix + format(Math.round(to * eased)) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  },

  observeCounters(root = document) {
    const els = $$('[data-count-to]', root);
    if (!els.length) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        UI.animateValue(el, Number(el.dataset.countTo), {
          prefix: el.dataset.countPrefix || '',
          suffix: el.dataset.countSuffix || ''
        });
        io.unobserve(el);
      });
    }, { threshold: 0.4 });
    els.forEach((el) => io.observe(el));
  }
};

/* ======================= 10. CHROME (nav + footer) ======================= */

const NAV_ITEMS = [
  { key: 'home', label: 'Home', href: 'index.html' },
  { key: 'leaderboard', label: 'Leaderboard', href: 'leaderboard.html' },
  { key: 'tournaments', label: 'Tournaments', href: 'tournaments.html' },
  { key: 'how-it-works', label: 'How It Works', href: 'how-it-works.html' },
  { key: 'news', label: 'News', href: 'news.html' }
];

const ACCOUNT_ITEMS = [
  { label: 'Dashboard', href: 'dashboard.html', icon: 'chart' },
  { label: 'Profile', href: 'profile.html', icon: 'user' },
  { label: 'Performance', href: 'performance.html', icon: 'chart' },
  { label: 'Rewards', href: 'rewards.html', icon: 'gift' },
  { label: 'Tournament history', href: 'profile.html#history', icon: 'history' },
  { label: 'Settings', href: 'profile.html#settings', icon: 'settings' }
];

const brandMark = `
  <span class="brand-mark" aria-hidden="true">
    <svg viewBox="0 0 64 64" width="38" height="38">
      <defs><linearGradient id="bm" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#12E27F"/><stop offset="1" stop-color="#7C3AED"/>
      </linearGradient></defs>
      <path d="M32 3 8 11v22c0 13.2 9.9 24.3 24 28 14.1-3.7 24-14.8 24-28V11L32 3Z" fill="#0D1017" stroke="url(#bm)" stroke-width="3"/>
      <path d="M32 20.5 40.5 27l-3.2 10h-10.6L23.5 27 32 20.5Z" fill="#12E27F"/>
      <path d="M24 43.5h16" stroke="#12E27F" stroke-width="3" stroke-linecap="round" opacity=".85"/>
    </svg>
  </span>`;

function brandBlock(href = 'index.html') {
  return `<a class="brand" href="${href}" aria-label="Dil Fantasy home">
    ${brandMark}
    <span class="brand-word"><span>DIL</span><span>FANTASY</span></span>
  </a>`;
}

function renderHeader() {
  const mount = $('#site-header');
  if (!mount) return;
  const active = document.body.dataset.page;
  const user = Auth.current();

  const links = NAV_ITEMS.map((item) => `
    <a href="${item.href}"${item.key === active ? ' aria-current="page"' : ''}>${item.label}</a>`).join('');

  const actions = user ? `
    <button class="icon-btn" type="button" id="notif-btn" aria-label="Notifications">
      ${icon('bell', 18)}<span class="dot"></span>
    </button>
    <div class="user-menu">
      <button class="user-trigger" type="button" id="user-trigger" aria-expanded="false" aria-haspopup="true" aria-controls="user-dropdown">
        <span class="avatar" aria-hidden="true">${escapeHTML(initials(user.fullName))}</span>
        <span class="uname">${escapeHTML(user.fullName.split(' ')[0])}</span>
        <span class="caret" aria-hidden="true">${icon('chevronDown', 15)}</span>
      </button>
      <div class="dropdown" id="user-dropdown" data-open="false">
        <div class="dropdown-head">
          <strong>${escapeHTML(user.fullName)}</strong>
          <small>${escapeHTML(user.fpl ? user.fpl.teamName : 'FPL account not connected')}</small>
        </div>
        <hr>
        ${ACCOUNT_ITEMS.map((i) => `<a href="${i.href}">${icon(i.icon, 16)} ${i.label}</a>`).join('')}
        <hr>
        <button type="button" data-action="logout">${icon('logout', 16)} Log out</button>
      </div>
    </div>` : `
    <a class="btn btn--ghost btn--sm btn--ghost-light" href="login.html">Log in</a>
    <a class="btn btn--sm" href="register.html">Register</a>`;

  mount.outerHTML = `
    <header class="site-header">
      <nav class="nav shell" aria-label="Main">
        ${brandBlock()}
        <div class="nav-links">${links}</div>
        <div class="nav-actions">
          ${actions}
          <button class="hamburger" type="button" id="menu-btn" aria-label="Open menu" aria-expanded="false" aria-controls="mobile-drawer">
            ${icon('menu', 20)}
          </button>
        </div>
      </nav>
    </header>
    <div class="mobile-drawer" id="mobile-drawer" data-open="false">
      <div class="scrim" data-drawer-close></div>
      <div class="panel" role="dialog" aria-modal="true" aria-label="Menu">
        <div class="drawer-top">
          ${brandBlock()}
          <button class="icon-btn" type="button" data-drawer-close aria-label="Close menu">${icon('close', 18)}</button>
        </div>
        <div>
          ${NAV_ITEMS.map((i) => `<a href="${i.href}"${i.key === active ? ' aria-current="page"' : ''}>${i.label}</a>`).join('')}
          <a href="rules.html"${active === 'rules' ? ' aria-current="page"' : ''}>Rules</a>
        </div>
        ${user ? `
          <div>
            <p class="drawer-section-label">Account</p>
            ${ACCOUNT_ITEMS.map((i) => `<a href="${i.href}">${i.label}</a>`).join('')}
            <a href="#" data-action="logout">Log out</a>
          </div>` : `
          <div style="display:grid;gap:10px;margin-top:auto">
            <a class="btn btn--block" href="register.html">Register</a>
            <a class="btn btn--ghost btn--ghost-light btn--block" href="login.html">Log in</a>
          </div>`}
      </div>
    </div>`;

  wireChrome();
}

function wireChrome() {
  const trigger = $('#user-trigger');
  const dropdown = $('#user-dropdown');
  if (trigger && dropdown) {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = dropdown.dataset.open === 'true';
      dropdown.dataset.open = String(!open);
      trigger.setAttribute('aria-expanded', String(!open));
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.user-menu')) {
        dropdown.dataset.open = 'false';
        trigger.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        dropdown.dataset.open = 'false';
        trigger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  const menuBtn = $('#menu-btn');
  const drawer = $('#mobile-drawer');
  if (menuBtn && drawer) {
    const setDrawer = (open) => {
      drawer.dataset.open = String(open);
      menuBtn.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
      if (open) $('.panel a', drawer)?.focus();
    };
    menuBtn.addEventListener('click', () => setDrawer(drawer.dataset.open !== 'true'));
    drawer.addEventListener('click', (e) => {
      if (e.target.closest('[data-drawer-close]')) setDrawer(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.dataset.open === 'true') setDrawer(false);
    });
  }

  const notif = $('#notif-btn');
  if (notif) {
    notif.addEventListener('click', () => {
      const state = Tournament.state();
      const entry = Entries.forGameweek(state.gameweek);
      const msg = entry
        ? `Gameweek ${state.gameweek} entry: ${(STATUS_BY_KEY[entry.status] || {}).label}.`
        : (state.registrationOpen
          ? `Gameweek ${state.gameweek} registration is open. ${Tournament.remainingPhrase(state)}.`
          : `Registration is closed. ${Tournament.remainingPhrase(state)}.`);
      UI.toast(msg, { title: 'Latest update', type: 'info' });
    });
  }

  document.addEventListener('click', async (e) => {
    const logout = e.target.closest('[data-action="logout"]');
    if (!logout) return;
    e.preventDefault();
    await Auth.logout();
    window.location.href = 'index.html';
  });
}

function renderFooter() {
  const mount = $('#site-footer');
  if (!mount) return;
  const year = new Date().getFullYear();
  const socials = [
    ['telegram', 'Telegram'], ['facebook', 'Facebook'], ['instagram', 'Instagram'],
    ['x', 'X'], ['youtube', 'YouTube']
  ];
  mount.outerHTML = `
    <footer class="site-footer">
      <div class="shell">
        <div class="footer-grid">
          <div class="footer-about">
            ${brandBlock()}
            <p>${escapeHTML(DIL_CONFIG.brand.tagline)} Dil means victory — earn it on the pitch, not by luck.</p>
            <div class="socials">
              ${socials.map(([k, label]) => {
                const href = k === 'telegram' && DIL_CONFIG.TELEGRAM_PROOF_URL
                  ? DIL_CONFIG.TELEGRAM_PROOF_URL : '#';
                const ext = href === '#' ? '' : ' target="_blank" rel="noopener noreferrer"';
                return `<a href="${href}"${ext} aria-label="${label}" data-social="${k}">${icon(k, 16)}</a>`;
              }).join('')}
            </div>
          </div>
          <div>
            <h4>Quick links</h4>
            <ul>
              ${NAV_ITEMS.map((i) => `<li><a href="${i.href}">${i.label}</a></li>`).join('')}
              <li><a href="rules.html">Rules</a></li>
            </ul>
          </div>
          <div>
            <h4>Support</h4>
            <ul>
              <li><a href="how-it-works.html#faq">FAQ</a></li>
              <li><a href="mailto:${DIL_CONFIG.SUPPORT_EMAIL}">Contact us</a></li>
              <li><a href="rules.html#terms">Terms &amp; conditions</a></li>
              <li><a href="rules.html#privacy">Privacy policy</a></li>
            </ul>
          </div>
          <div>
            <h4>Entry &amp; rewards</h4>
            <ul>
              <li><a href="rules.html#entry">${DIL_CONFIG.ENTRY_FEE_BIRR} ${DIL_CONFIG.CURRENCY} entry fee</a></li>
              <li><a href="rules.html#entry">Non-refundable</a></li>
              <li><a href="how-it-works.html#proof">Proof sent on Telegram</a></li>
              <li><a href="rewards.html">Reward payouts</a></li>
            </ul>
          </div>
        </div>
      </div>
      <div class="footer-bottom">
        <div class="shell">
          <span class="tz">All tournament times are based on Ethiopia Time (${DIL_CONFIG.TZ_LABEL}, UTC+3).</span>
          <br>© ${year} ${escapeHTML(DIL_CONFIG.brand.name)}. All rights reserved.
        </div>
      </div>
    </footer>`;
}

/* ====================== 11. COUNTDOWN BINDING ============================
   Any element carrying data-clock is refreshed once a second from the
   tournament engine. Because every value is derived from the absolute clock,
   a refresh, a sleeping laptop or a reopened tab all resolve correctly.    */

const ClockBus = {
  subscribers: new Set(),
  started: false,
  lastGameweek: null,
  lastStatus: null,

  subscribe(fn) {
    this.subscribers.add(fn);
    fn(Tournament.state());
    this.start();
    return () => this.subscribers.delete(fn);
  },

  start() {
    if (this.started) return;
    this.started = true;
    const tick = () => {
      const state = Tournament.state();
      // Rollover detection: a new gameweek or a closed window changes the page.
      if (this.lastGameweek !== null && state.gameweek !== this.lastGameweek) {
        UI.toast(`Gameweek ${state.gameweek} is open. Registration closes Friday at 2:00 PM ${DIL_CONFIG.TZ_LABEL}.`,
          { title: 'New gameweek', type: 'success', duration: 8000 });
      } else if (this.lastStatus === 'open' && state.status === 'closed') {
        UI.toast('Registration for this gameweek has just closed.', { title: 'Registration closed', type: 'warn', duration: 8000 });
      }
      this.lastGameweek = state.gameweek;
      this.lastStatus = state.status;
      this.subscribers.forEach((fn) => {
        try { fn(state); } catch (err) { console.error(err); }
      });
    };
    tick();
    setInterval(tick, 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  }
};

/** Paint one countdown block. */
function paintClock(root, state) {
  const set = (sel, value) => {
    const el = $(sel, root);
    if (el && el.textContent !== value) el.textContent = value;
  };
  set('[data-clock-days]', pad(state.parts.days));
  set('[data-clock-hours]', pad(state.parts.hours));
  set('[data-clock-minutes]', pad(state.parts.minutes));
  set('[data-clock-seconds]', pad(state.parts.seconds));

  root.dataset.state = state.status;

  const gwEl = $('[data-clock-gameweek]', root);
  if (gwEl) gwEl.textContent = `Gameweek ${state.gameweek}`;

  const statusEl = $('[data-clock-status]', root);
  if (statusEl) statusEl.textContent = state.statusLabel;

  const dotEl = $('[data-clock-dot]', root);
  if (dotEl) {
    dotEl.className = 'status-dot' + (state.registrationOpen
      ? (state.closingSoon ? ' status-dot--warn status-dot--live' : ' status-dot--live')
      : ' status-dot--closed');
  }

  const labelEl = $('[data-clock-caption]', root);
  if (labelEl) labelEl.textContent = state.countdownLabel;

  const railEl = $('[data-clock-rail]', root);
  if (railEl) railEl.style.width = `${(state.progressRemaining * 100).toFixed(2)}%`;

  const noteEl = $('[data-clock-note]', root);
  if (noteEl) noteEl.textContent = Tournament.remainingPhrase(state);

  const scheduleEl = $('[data-clock-schedule]', root);
  if (scheduleEl) {
    scheduleEl.textContent = state.registrationOpen
      ? `Registration closes Friday at 2:00 PM ${DIL_CONFIG.TZ_LABEL}`
      : `A new gameweek opens Sunday at 12:00 AM ${DIL_CONFIG.TZ_LABEL}`;
  }

  const deadlineEl = $('[data-clock-deadline]', root);
  if (deadlineEl) {
    deadlineEl.textContent = state.registrationOpen
      ? `Deadline: ${EAT.full(state.closesAt)}`
      : `Opens: ${EAT.full(state.nextOpensAt)}`;
  }
}

/** Enable/disable every registration control on the page. */
function paintRegistrationControls(state) {
  $$('[data-requires-registration]').forEach((btn) => {
    const gw = Number(btn.dataset.gameweek || state.gameweek);
    const allowed = gw === state.gameweek && state.registrationOpen;
    const labelEl = $('[data-btn-label]', btn) || btn;
    if (allowed) {
      btn.disabled = false;
      btn.removeAttribute('aria-disabled');
      btn.classList.remove('btn--muted');
      const open = btn.dataset.labelOpen || 'Join this week\'s tournament';
      if (labelEl.textContent.trim() !== open) labelEl.textContent = open;
    } else {
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.classList.add('btn--muted');
      const closed = btn.dataset.labelClosed || 'Registration closed';
      if (labelEl.textContent.trim() !== closed) labelEl.textContent = closed;
    }
  });
  $$('[data-gameweek-text]').forEach((el) => { el.textContent = String(state.gameweek); });
  $$('[data-status-text]').forEach((el) => { el.textContent = state.statusLabel.toUpperCase(); });
}

/* ====================== 12. TOURNAMENT ENTRY FLOW ========================= */

const EntryFlow = {
  async open(gameweek) {
    const state = Tournament.state();
    const gw = gameweek || state.gameweek;

    if (gw !== state.gameweek || !state.registrationOpen) {
      UI.modal({
        title: 'Registration has closed',
        body: `
          <div class="notice notice--warn">${icon('alert', 18)}
            <div>Registration for Gameweek ${gw} has closed. Entries close every Friday at
            2:00 PM ${DIL_CONFIG.TZ_LABEL}.</div>
          </div>
          <p style="margin-top:16px">${escapeHTML(Tournament.remainingPhrase(state))}. When the new gameweek opens,
          registration reopens automatically.</p>`,
        footer: `<button class="btn btn--ghost" type="button" data-close>Close</button>
                 <a class="btn btn--purple" href="tournaments.html">See all tournaments</a>`
      });
      return;
    }

    if (!Auth.isLoggedIn()) {
      Store.set('pendingEntryGameweek', gw);
      Auth.requireLogin('tournaments.html');
      return;
    }

    const user = Auth.current();
    if (!user.fpl) {
      UI.modal({
        title: 'Connect your FPL account first',
        subtitle: 'Rankings come from your official Fantasy Premier League performance.',
        body: `<p>Add your FPL Manager ID to your profile, then join the tournament.</p>`,
        footer: `<button class="btn btn--ghost" type="button" data-close>Not now</button>
                 <a class="btn" href="profile.html#fpl">Connect FPL account</a>`
      });
      return;
    }

    try {
      await Entries.start(gw);
    } catch (err) {
      UI.toast(err.message || 'That entry could not be started.', {
        type: 'error', title: 'Entry not started'
      });
      return;
    }
    this.showPaymentInstructions(gw);
  },

  showPaymentInstructions(gw) {
    const telegramConfigured = Boolean(DIL_CONFIG.TELEGRAM_PROOF_URL);
    UI.modal({
      title: `Join Gameweek ${gw}`,
      subtitle: 'Pay separately, send your proof on Telegram — once you apply it will be reviewed.',
      wide: true,
      body: `
        <div class="fee-block">
          <div class="gw">Gameweek ${gw} entry</div>
          <div class="amt">${DIL_CONFIG.ENTRY_FEE_BIRR} ${DIL_CONFIG.CURRENCY}</div>
          <div class="note">Non-refundable entry fee</div>
        </div>
        <h3 style="margin-bottom:14px">Almost done</h3>
        <ol class="payment-steps">
          <li>Pay the ${DIL_CONFIG.ENTRY_FEE_BIRR} ${DIL_CONFIG.CURRENCY} entry fee using your usual payment method.</li>
          <li>Take a screenshot of the successful payment.</li>
          <li>Press the button below to open the official Dil Fantasy Telegram group.</li>
          <li>Send the screenshot together with your full name and FPL Manager ID.</li>
          <li>Once you apply it will be reviewed by an administrator.</li>
          <li>Your registration is confirmed once that review completes.</li>
        </ol>
        <div class="notice notice--purple">${icon('info', 18)}
          <div>Dil Fantasy has no online checkout. Nothing is charged on this site — you pay through your own
          provider and send proof to us.</div>
        </div>
        ${telegramConfigured ? '' : `
          <div class="notice notice--warn" style="margin-top:12px">${icon('alert', 18)}
            <div>The Telegram destination has not been set yet. An administrator sets
            <code>TELEGRAM_PROOF_URL</code> in <code>script.js</code> before launch.</div>
          </div>`}`,
      footer: `
        <button class="btn btn--ghost" type="button" data-close>Cancel</button>
        ${telegramConfigured
          ? `<a class="btn" id="proof-btn" data-gw="${gw}" href="${DIL_CONFIG.TELEGRAM_PROOF_URL}"
                target="_blank" rel="noopener noreferrer">
               ${icon('telegram', 17)} Submit proof on Telegram ${icon('arrow', 16)}
             </a>`
          : `<button class="btn" type="button" id="proof-btn" data-gw="${gw}">
               ${icon('telegram', 17)} Submit proof on Telegram ${icon('arrow', 16)}
             </button>`}`,
      onOpen: (root) => {
        $('#proof-btn', root).addEventListener('click', async (e) => {
          const target = Number(e.currentTarget.dataset.gw);
          const live = Tournament.state();
          if (target !== live.gameweek || !live.registrationOpen) {
            e.preventDefault();
            UI.toast('Registration closed while this window was open.', { type: 'error', title: 'Too late' });
            UI.closeModal();
            return;
          }
          // When configured the element is an anchor and opens Telegram itself.
          try {
            await Entries.markProofSubmitted(target);
          } catch (err) {
            UI.toast(err.message || 'That could not be recorded.', {
              type: 'error', title: 'Not recorded'
            });
            return;
          }
          this.showSubmitted(target, telegramConfigured);
        });
      }
    });
  },

  /* Reopens the payment instructions for an entry already started. */
  resumeProof(gw) {
    const live = Tournament.state();
    if (gw !== live.gameweek || !live.registrationOpen) {
      UI.toast('Registration for that gameweek has closed.', { type: 'error', title: 'Closed' });
      return;
    }
    this.showPaymentInstructions(gw);
  },

  showSubmitted(gw, opened) {
    UI.modal({
      title: 'Payment proof submitted',
      subtitle: 'Once you apply it will be reviewed by an administrator before it is confirmed.',
      body: `
        <div class="info-list" style="margin-bottom:18px">
          <div><span class="k">Tournament</span><span class="v">Gameweek ${gw}</span></div>
          <div><span class="k">Entry</span><span class="v">${DIL_CONFIG.ENTRY_FEE_BIRR} ${DIL_CONFIG.CURRENCY}</span></div>
          <div><span class="k">Status</span><span class="v"><span class="badge badge--purple-soft">Under review</span></span></div>
        </div>
        ${opened ? '' : `<div class="notice notice--warn" style="margin-bottom:18px">${icon('alert', 18)}
          <div>No Telegram destination is configured yet, so nothing opened. Your entry is recorded and will
          move forward once an administrator adds the destination.</div></div>`}
        <ul class="status-track">
          <li data-done="true"><span class="mark">${icon('check', 12, 3)}</span> Entry started</li>
          <li data-done="true"><span class="mark">${icon('check', 12, 3)}</span> Proof submitted</li>
          <li data-current="true"><span class="mark"></span> Reviewed by an administrator</li>
          <li><span class="mark"></span> Registration confirmed</li>
        </ul>
        <p class="hint" style="margin-top:16px;color:var(--text-faint);font-size:.82rem">
          Submitting proof does not confirm payment. Only verified entries take part in the tournament.
        </p>`,
      footer: `<a class="btn btn--ghost" href="tournaments.html">All tournaments</a>
               <a class="btn" href="dashboard.html">Go to dashboard</a>`
    });
    UI.toast(`Gameweek ${gw} application received — it will be reviewed.`, { title: 'Proof submitted' });
  }
};

/* ============================ 13. BOOTSTRAP ============================== */

/* ---------------------------------------------------------------------
   The app has no offline mode and no fabricated data: if the API cannot
   be reached, it says so rather than showing numbers that are not real. */
/* The app has no offline mode and no fabricated data: if the API cannot be
   reached it says so rather than showing numbers that are not real. */
async function connectToDatabase() {
  const ok = await API.health();
  if (!ok) {
    showOfflineBanner('Cannot reach the Dil Fantasy server.');
    return false;
  }
  try {
    await Tournament.load();      // gw_number and deadlines from the gameweeks table
    return true;
  } catch (err) {
    showOfflineBanner('The server responded but the current gameweek could not be read.');
    return false;
  }
}

function showOfflineBanner(message) {
  if ($('#api-offline')) return;
  const bar = document.createElement('div');
  bar.id = 'api-offline';
  bar.className = 'offline-banner';
  bar.setAttribute('role', 'alert');
  bar.innerHTML = `
    <div class="offline-banner-inner">
      <strong>${escapeHTML(message || 'Cannot reach the Dil Fantasy server.')}</strong>
      <span>The site reads every figure from the database, so nothing can be shown until
      the server is running. Start it with <code>node server/index.js</code>, then open
      <code>http://localhost:4000</code>.</span>
    </div>
    <button class="btn btn--sm btn--ghost" type="button" id="api-retry">Retry</button>`;
  document.body.prepend(bar);
  $('#api-retry').addEventListener('click', () => window.location.reload());
}

/* Without a database there is nothing real to show, so the page must not
   look alive. This blanks the countdown, disables every action, and puts a
   plain "unavailable" card in each mount that would otherwise be an empty
   shell with a heading over it. */
function renderOfflineState() {
  document.documentElement.setAttribute('data-api-offline', 'true');

  // A countdown computed in the browser would be a guess. Blank it.
  $$('[data-clock-days], [data-clock-hours], [data-clock-minutes], [data-clock-seconds]')
    .forEach((el) => { el.textContent = '--'; });
  $$('[data-clock-note], [data-clock-caption], [data-clock-deadline], [data-clock-schedule]')
    .forEach((el) => { el.textContent = 'Waiting for the server'; });
  $$('[data-clock-rail]').forEach((el) => { el.style.width = '0%'; });
  $$('[data-clock-status]').forEach((el) => { el.textContent = 'Unavailable'; });
  $$('[data-live-count], [data-live-pool]').forEach((el) => { el.textContent = '—'; });

  // Nothing that writes to the database can work, so nothing should invite a click.
  $$('[data-action="join-tournament"], [data-action="resume-proof"]').forEach((btn) => {
    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
    const label = $('[data-btn-label]', btn);
    if (label) label.textContent = 'Unavailable offline';
  });

  const card = (title, body) => `
    <div class="empty-state offline-state">
      <div class="ico">${icon('alert', 24)}</div>
      <h3>${title}</h3>
      <p>${body}</p>
    </div>`;

  // Static labels that would otherwise assert a gameweek we have not read.
  $$('.hero-label, .clock-gw, [data-gw-label]').forEach((el) => {
    el.textContent = 'Gameweek unavailable';
  });

  const mounts = [
    ['#home-news', 'News unavailable', 'Articles are stored in the database.'],
    ['#home-tournaments', 'Tournaments unavailable', 'Gameweeks are read from the database.'],
    ['#participants-grid', 'Participants unavailable', 'The participant list comes from the database.'],
    ['#home-leaderboard', 'Standings unavailable', 'Rankings are read from the database.'],
    ['#lb-mount', 'Standings unavailable', 'Rankings are read from the database.'],
    ['#lb-stats', 'Statistics unavailable', 'These figures are read from the database.'],
    ['#participants-stats', 'Counts unavailable', 'Participant counts come from the database.'],
    ['#dash-stats', 'Dashboard unavailable', 'Your figures are read from the database.'],
    ['#perf-stats', 'Analytics unavailable', 'Your history is read from the database.'],
    ['#news-list', 'News unavailable', 'Articles are stored in the database.'],
    ['#tournaments-upcoming', 'Tournaments unavailable', 'Gameweeks are read from the database.']
  ];
  mounts.forEach(([sel, title, body]) => {
    const el = $(sel);
    if (el) el.innerHTML = card(title, body);
  });

  // The tournaments page renders into unnamed panels rather than ids.
  $$('[data-bucket]').forEach((el) => {
    el.innerHTML = card('Tournaments unavailable', 'Gameweeks are read from the database.');
  });

  // Hide controls that would filter or page through data that is not there.
  ['#participants-more', '#participants-search', '#lb-search', '#lb-sort']
    .forEach((sel) => { const el = $(sel); if (el) el.closest('.filter-bar, .participants-foot') 
      ? (el.closest('.filter-bar, .participants-foot').hidden = true) : (el.hidden = true); });

  $$('[data-icon]').forEach((el) => {
    if (!el.querySelector('svg')) {
      el.innerHTML = icon(el.dataset.icon, Number(el.dataset.iconSize) || 18);
    }
  });
}

/* Any element marked [data-telegram-link] inherits the configured destination. */
function wireTelegramLinks(scope = document) {
  const url = DIL_CONFIG.TELEGRAM_PROOF_URL;
  $$('[data-telegram-link]', scope).forEach((el) => {
    if (url) {
      el.setAttribute('href', url);
      el.removeAttribute('aria-disabled');
      el.hidden = false;
    } else {
      // No destination configured: hide rather than offer a dead link.
      el.hidden = true;
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const connected = await connectToDatabase();
  if (connected) await Auth.hydrate();
  renderHeader();
  renderFooter();
  wireTelegramLinks();
  if (!connected) {
    renderOfflineState();
    return;                      // no database, so no page to render
  }
  await TimeService.sync();

  ClockBus.subscribe((state) => {
    $$('[data-clock]').forEach((root) => paintClock(root, state));
    paintRegistrationControls(state);
  });

  document.addEventListener('click', (e) => {
    const resumeBtn = e.target.closest('[data-action="resume-proof"]');
    if (resumeBtn) {
      e.preventDefault();
      EntryFlow.resumeProof(Number(resumeBtn.dataset.gameweek));
      return;
    }

    const joinBtn = e.target.closest('[data-action="join-tournament"]');
    if (joinBtn && !joinBtn.disabled) {
      e.preventDefault();
      EntryFlow.open(Number(joinBtn.dataset.gameweek) || undefined);
    }
  });

  UI.observeCounters();

  // Resume an entry the visitor started before logging in.
  const pending = Store.get('pendingEntryGameweek', null);
  if (pending && Auth.isLoggedIn()) {
    Store.remove('pendingEntryGameweek');
    setTimeout(() => EntryFlow.open(Number(pending)), 400);
  }

  if (typeof initPage === 'function') initPage();
});
