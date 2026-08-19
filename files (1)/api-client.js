/* =====================================================================
   DIL FANTASY — api-client.js
   The ONLY place in the front end that calls fetch(). No page script
   builds a URL or touches the network directly; they all come through
   here, so the API contract lives in one file.

   Contains no credentials and no secrets. The session is an HttpOnly
   cookie the browser cannot read, set by the server at login.

   Load order: api-client.js → script.js → pages.js
   ===================================================================== */

'use strict';

const API = {
  /* Same-origin by default: server/index.js serves the API and the site
     together. Point this elsewhere only if the API moves to another host
     (which then needs CORS configured). */
  baseUrl: '/api',
  timeoutMs: 12000,

  /** True once a reachable API has answered. */
  online: false,

  /* ------------------------------------------------------------- core */

  async request(path, { method = 'GET', body, signal } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    if (signal) signal.addEventListener('abort', () => controller.abort());

    let res;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timer);
      this.online = false;
      throw new ApiError(
        err.name === 'AbortError'
          ? 'The server took too long to respond.'
          : 'Could not reach the server.',
        { code: 'NETWORK', cause: err });
    }
    clearTimeout(timer);

    let data = {};
    try { data = await res.json(); } catch { /* empty body is fine */ }

    if (!res.ok) {
      throw new ApiError(
        (data.error && data.error.message) || `Request failed (${res.status})`,
        { code: (data.error && data.error.code) || 'HTTP_' + res.status, status: res.status });
    }
    this.online = true;
    return data;
  },

  get(path, options) { return this.request(path, { ...options, method: 'GET' }); },
  post(path, body, options) { return this.request(path, { ...options, method: 'POST', body }); },
  patch(path, body, options) { return this.request(path, { ...options, method: 'PATCH', body }); },

  /** Confirms the API is reachable before the app renders anything. */
  async health() {
    try {
      await this.get('/time');
      return true;
    } catch (err) {
      this.online = false;
      return false;
    }
  },

  /* --------------------------------------------------------- endpoints
     One method per row of the API contract. Nothing else in the front
     end knows these paths exist.                                      */

  time()                  { return this.get('/time'); },
  currentGameweek()       { return this.get('/gameweeks/current'); },

  /** Item 1 — the live participant count. */
  participantCount(gw)    { return this.get(`/gameweeks/${gw}/participants/count`); },

  /** Items 4 and 6 — the public participant list, from the same table. */
  participants(gw, { search = '', page = 1, pageSize = 12 } = {}) {
    const q = new URLSearchParams({ search, page: String(page), page_size: String(pageSize) });
    return this.get(`/gameweeks/${gw}/participants?${q}`);
  },

  /** Item 3 — leaderboard rows plus the stat bar, in one response. */
  leaderboard({ gameweek, scope = 'gameweek', size = 40 } = {}) {
    const q = new URLSearchParams({ scope, size: String(size) });
    if (gameweek) q.set('gameweek', String(gameweek));
    return this.get(`/leaderboard?${q}`);
  },

  /** Item 5 — one aggregated dashboard call. */
  dashboard(userId)       { return this.get(`/users/${userId}/dashboard`); },
  performance(userId)     { return this.get(`/users/${userId}/performance`); },
  rewards(userId)         { return this.get(`/users/${userId}/rewards`); },

  myRegistrations()       { return this.get('/me/registrations'); },
  createRegistration(gameweek, paymentMethod) {
    return this.post('/registrations', { gameweek, paymentMethod });
  },
  submitProof(registrationId, payload = {}) {
    return this.post(`/registrations/${registrationId}/proof`, payload);
  },
  verifyRegistration(registrationId, approve = true) {
    return this.post(`/registrations/${registrationId}/verify`, { approve });
  },

  register(payload)       { return this.post('/auth/register', payload); },
  login(email, password)  { return this.post('/auth/login', { email, password }); },
  logout()                { return this.post('/auth/logout'); },
  me()                    { return this.get('/auth/me'); },

  connectFpl(managerId, teamName) { return this.patch('/me/fpl', { managerId, teamName }); },
  saveReward(payload)             { return this.patch('/me/reward', payload); },
  fplManager(managerId)           { return this.get(`/fpl/manager/${managerId}`); }
};

/** Carries the server's error code so callers can react to specific cases. */
class ApiError extends Error {
  constructor(message, { code = 'ERROR', status = 0, cause } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.cause = cause;
  }
  /** True when the failure was the network rather than a rejected request. */
  get isOffline() { return this.code === 'NETWORK'; }
}

window.API = API;
window.ApiError = ApiError;
