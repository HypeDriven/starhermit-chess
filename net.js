/* net.js — auth, token lifecycle, REST + WebSocket plumbing, routed through
   window.StarHermit (starhermit-sdk.js, loaded and init()ed from index.html
   before this file). The SDK reads the launch token (#game_token / sign-in
   #access_token), renews it and owns every platform call; Net keeps the
   game's original surface (Net.api / gamePath / wsUrl / userId / slug) and
   the local-development sign-in (paste a user JWT, exchange it for a
   game-scoped launch token). */
'use strict';

const SH = window.StarHermit;
const TOKEN_KEY = 'chess.gameToken';

// Keyboard actions — declared as control.<action> in starhermit.txt. On the
// board they move focus / play a square; in the replay viewer left/right/
// row_start/row_end step through the moves.
const DEFAULT_BINDINGS = {
  up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
  row_start: ['Home'], row_end: ['End'], select: ['Enter', 'Space'],
};
const KEY_FALLBACK = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Home: 'row_start', End: 'row_end', Enter: 'select', ' ': 'select', Spacebar: 'select',
};

// T() lives in ui.js (loaded after this file); these run only at call time.
const tr = (key, vars) => (window.CHI18N ? window.CHI18N.T(key, vars) : String(key).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? vars[k] : m)));
const unreachable = () => (SH.base ? tr('Cannot reach the server at {base}', { base: SH.base }) : tr('Cannot reach the server'));

const Net = {
  /** Set by app.js — called with a message thunk (re-read on a language change) when auth is lost. */
  onAuthLost: null,

  /** StarHermit platform strings (platform-strings.js) in the game's current language. */
  platformText() {
    const lang = (window.CHI18N && window.CHI18N.lang) || navigator.language;
    return window.PlatformStrings.platformStrings(lang);
  },
  bindings: Object.fromEntries(Object.entries(DEFAULT_BINDINGS).map(([k, v]) => [k, v.slice()])),
  _codeMap: null,

  // Empty base = same origin: launched from the platform, the game and the API
  // share an origin. The dev panel can point it elsewhere for local development.
  get base() { return SH.base; },
  get token() { return SH.token; },
  get userId() { return SH.userId; },
  // The game's slug on the platform, from the launch token's game_scope claim
  // (or the <slug>.starhermit.com host) — never hard-coded.
  get slug() { return SH.slug; },

  setBase(url) {
    SH.base = (url || '').replace(/\/+$/, '');
    try { localStorage.setItem('chess.apiBase', SH.base); } catch (e) { /* storage off */ }
  },

  setToken(token) { SH.setToken(token); },

  clearToken() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
    SH.signOut('cleared');
  },

  /** Path for one of this game's endpoints, e.g. gamePath('/matchmaking'). */
  gamePath(suffix = '') { return SH.gamePath(suffix); },

  decodeJwt(token) { return SH.decodeJwt(token); },

  /** REST call under the API base. Returns parsed JSON (null for 204/404). Throws {status, message}. */
  async api(path, opts = {}) {
    if (!SH.token) throw { status: 401, message: tr('Not signed in.') };
    try {
      return await SH.api(path, { method: opts.method || 'GET', body: opts.body });
    } catch (e) {
      if (e && e.status === 401) { this.clearToken(); throw { status: 401, message: tr('Not signed in.') }; }
      if (e && typeof e.status === 'number') throw e;
      throw { status: 0, message: unreachable() };
    }
  },

  /** Authenticated GET for binary content (e.g. avatars). Returns a Blob, or null if absent. */
  async apiBlob(path) {
    try { return await SH.api(path, { blob: true }); } catch (e) { return null; }
  },

  /**
   * Local development sign-in: exchange a pasted user JWT for this game's
   * launch token (POST launch-token), then hand it to the SDK, which renews it.
   */
  async launchToken(userJwt, slug) {
    if (!userJwt) return SH.refresh();
    const targetSlug = slug || this.slug;
    if (!targetSlug) throw { status: 0, message: tr('No game slug — provide one to launch.') };
    let res;
    try {
      res = await fetch(SH.base + '/api/v1/games/' + encodeURIComponent(targetSlug) + '/launch-token',
        { method: 'POST', headers: { 'Authorization': 'Bearer ' + userJwt } });
    } catch (e) {
      throw { status: 0, message: unreachable() };
    }
    let json = null;
    try { json = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok || !json || !json.token) {
      const msg = (json && (json.error || json.message)) || tr('Token request failed ({status})', { status: res.status });
      throw { status: res.status, message: String(msg) };
    }
    this.setToken(json.token);
    return json;
  },

  /** ws(s):// URL for a /ws/v1/... path, derived from the API base (or this origin). */
  wsUrl(path, params = {}) { return SH.wsUrl(path, params); },

  // ---- controls (StarHermit control bindings)
  async loadBindings() {
    try { this.bindings = await SH.loadBindings(DEFAULT_BINDINGS); } catch (e) { /* keep defaults */ }
    this._codeMap = null;
    return this.bindings;
  },
  /** Action for a keydown (event.code through the bindings; key for synthetic events). */
  actionFor(e) {
    if (!this._codeMap) {
      this._codeMap = {};
      for (const [a, codes] of Object.entries(this.bindings)) for (const c of codes) this._codeMap[c] = a;
    }
    if (e.code) return this._codeMap[e.code] || null;
    return KEY_FALLBACK[e.key] || null;
  },
};

if (SH.base === '') {
  try { SH.base = (localStorage.getItem('chess.apiBase') || '').replace(/\/+$/, ''); } catch (e) { /* storage off */ }
}

// The token survives a reload of this tab (sessionStorage, never localStorage):
// the platform strips it from the URL, so a refresh would otherwise sign out.
SH.on('auth', (a) => {
  try {
    if (a.signedIn && SH.token) sessionStorage.setItem(TOKEN_KEY, SH.token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch (e) { /* storage off */ }
  if (!a.signedIn && Net.onAuthLost) {
    // 'expired': renewal was refused — only the launcher (or sign-in) can mint
    // a new token, so the landing card offers "Back to StarHermit".
    Net.onAuthLost(a.reason === 'expired'
      ? () => (window.PlatformStrings ? Net.platformText().sessionExpired : tr('Your session expired.'))
      : () => tr('Signed out — sign in again to continue.'), a.reason || 'signed-out');
  }
});
if (SH.token) {
  try { sessionStorage.setItem(TOKEN_KEY, SH.token); } catch (e) { /* storage off */ }
} else {
  let stored = null;
  try { stored = sessionStorage.getItem(TOKEN_KEY); } catch (e) { /* storage off */ }
  const claims = stored ? SH.decodeJwt(stored) : null;
  if (claims && (!claims.exp || claims.exp * 1000 > Date.now() + 60000)) SH.setToken(stored);
  else if (stored) { try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } }
}
