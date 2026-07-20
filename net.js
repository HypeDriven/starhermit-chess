/* net.js — auth, token lifecycle, REST + WebSocket plumbing. */
'use strict';

const Net = {
  base: localStorage.getItem('chess.apiBase') || 'http://localhost:5050',
  token: sessionStorage.getItem('chess.gameToken') || null,
  userId: null,
  _refreshTimer: null,
  /** Set by app.js — called with a message when auth is lost (401 / refresh failure). */
  onAuthLost: null,

  setBase(url) {
    this.base = url.replace(/\/+$/, '');
    localStorage.setItem('chess.apiBase', this.base);
  },

  setToken(token) {
    this.token = token;
    sessionStorage.setItem('chess.gameToken', token);
    const claims = Net.decodeJwt(token);
    this.userId = claims && (claims.sub || claims.userId || claims.uid) || null;
  },

  clearToken() {
    this.token = null;
    this.userId = null;
    sessionStorage.removeItem('chess.gameToken');
    if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
  },

  decodeJwt(token) {
    try {
      const part = token.split('.')[1];
      const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(atob(b64).split('').map(
        c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      return JSON.parse(json);
    } catch (e) { return null; }
  },

  /** REST call under the API base. path starts with /api/... Returns parsed JSON (null for 204). */
  async api(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
    let body;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    let res;
    try {
      res = await fetch(this.base + path, { method: opts.method || 'GET', headers, body });
    } catch (e) {
      throw { status: 0, message: 'Cannot reach the server at ' + this.base };
    }
    if (res.status === 401) {
      const cb = this.onAuthLost;
      this.clearToken();
      if (cb) cb('Your session expired. Paste a user token to continue.');
      throw { status: 401, message: 'Not signed in.' };
    }
    if (res.status === 204) return null;
    let json = null;
    try { json = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const msg = (json && (json.error || json.message || json.detail)) || (res.status + ' ' + res.statusText);
      throw { status: res.status, message: String(msg), body: json };
    }
    return json;
  },

  /** POST launch-token using an explicit user JWT (dev panel) or the current scoped token (refresh). */
  async launchToken(userJwt) {
    const headers = { 'Authorization': 'Bearer ' + (userJwt || this.token) };
    let res;
    try {
      res = await fetch(this.base + '/api/v1/games/chess/launch-token', { method: 'POST', headers });
    } catch (e) {
      throw { status: 0, message: 'Cannot reach the server at ' + this.base };
    }
    let json = null;
    try { json = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok || !json || !json.token) {
      const msg = (json && (json.error || json.message)) || ('Token request failed (' + res.status + ')');
      throw { status: res.status, message: String(msg) };
    }
    this.setToken(json.token);
    return json;
  },

  /** Refresh the game-scoped token roughly every 45 minutes (it lives for 60). */
  startRefresh() {
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    this._refreshTimer = setInterval(async () => {
      try {
        await this.launchToken();
      } catch (e) {
        const cb = this.onAuthLost;
        this.clearToken();
        if (cb) cb('Could not refresh the session token. Paste a user token to continue.');
      }
    }, 45 * 60 * 1000);
  },

  /** ws(s):// URL for a /ws/v1/... path, derived from the API base. */
  wsUrl(path, params = {}) {
    const u = new URL(this.base);
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    const qs = new URLSearchParams(params).toString();
    return proto + '//' + u.host + path + (qs ? '?' + qs : '');
  },
};
