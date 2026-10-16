// reconnect.test.mjs — every socket reconnect renews the launch token first
// (an expired token is refused before the upgrade, reported only as 1006, so
// reopening the same URL can never recover). Covers the SDK gameplay socket
// (GameController.connect) and the game-managed voice socket
// (VoiceController): 'renewed' reopens with the new token, 'retry' never
// reopens the old URL, 'relaunch' stops and shows "Back to StarHermit".
// Pending terms consent ends the game like auth loss (landing card with
// "Back to StarHermit"); a session that is no longer active ends the loop
// with a visible note.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadSdkFactory, jwt, resp, fakeWindow, UID } from './starhermit-harness.mjs';

const SLUG = 'chess';
const src = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const T1 = jwt({ sub: UID, game_scope: SLUG, exp: Math.floor(Date.now() / 1000) + 3600, n: 1 });
const T2 = jwt({ sub: UID, game_scope: SLUG, exp: Math.floor(Date.now() / 1000) + 3600, n: 2 });

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

function fakeEl() {
  return {
    hidden: false, textContent: '', value: '', dataset: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [],
  };
}

/** Boots net.js + game.js + app.js against a hosted SDK with manual timers, a stub WebSocket and a scripted renewal. */
function boot() {
  const timers = [];
  const sockets = [];
  let renewal = () => resp(200, { token: T2 });
  let session = () => resp(200, { sessionId: 's1', status: 'active' });
  const renewCalls = [];
  const fetchStub = async (url, init = {}) => {
    const path = String(url);
    if (path === `/api/v1/games/${SLUG}/launch-token`) { renewCalls.push(path); return renewal(); }
    if (path === `/api/v1/games/${SLUG}/sessions/s1`) return session();
    return resp(404, null);
  };
  class WS {
    constructor(url) { this.url = url; this.readyState = 0; this.token = new URL(url).searchParams.get('access_token'); sockets.push(this); }
    send() {}
    close() { this.readyState = 3; }
  }
  WS.OPEN = 1;
  const win = fakeWindow('#game_token=' + T1);
  win.location.href = 'http://localhost/';
  let relaunched = 0;
  const els = {};
  globalThis.window = win;
  globalThis.document = {
    hidden: false, addEventListener() {}, removeEventListener() {},
    documentElement: { lang: 'en' }, querySelectorAll: () => [],
    getElementById: (id) => (els[id] = els[id] || fakeEl()),
  };
  globalThis.localStorage = memStorage();
  globalThis.sessionStorage = memStorage();
  // Socket backoffs (≤ 30 s) run on flush(); the SDK's background token refresh (≥ 60 s) never does.
  const setT = (fn, ms) => { if (!(ms >= 60e3)) timers.push(fn); return timers.length; };
  const sdk = loadSdkFactory().create({ window: win, fetch: fetchStub, WebSocket: WS, setTimeout: setT, clearTimeout() {} }).init();
  sdk.relaunch = () => { relaunched++; return true; };
  win.StarHermit = sdk;
  const ps = { self: {} };
  new Function('self', 'module', src('platform-strings.js'))(ps.self, undefined);
  win.PlatformStrings = ps.self.PlatformStrings;
  const toasts = [];
  const UI = new Proxy({ toast: (m) => toasts.push(m), onTick: () => () => {} }, { get: (t, k) => t[k] || (() => {}) });
  const code = src('net.js') + '\n' + src('game.js') + '\n' + src('app.js').replace(/\nApp\.init\(\);\s*$/, '\n').replace(/\ndocument\.addEventListener\('ch-language'[^\n]*\n/, '\n') +
    '\nreturn { Net, App, GameController, VoiceController };';
  // ui.js's i18n helpers (English: no CHI18N in this harness).
  const T = (k, vars) => String(k).replace(/\{(\w+)\}/g, (m, n) => (vars && n in vars ? vars[n] : m));
  const txt = (v) => (typeof v === 'function' ? v() : v);
  const mod = new Function('window', 'document', 'navigator', 'WebSocket', 'setTimeout', 'UI', '$', 'Sfx', 'T', 'N', 'txt', code)(
    win, globalThis.document, { language: 'en-US' }, WS, setT, UI, (id) => globalThis.document.getElementById(id), { play() {} }, T, (k) => k, txt);
  mod.App.enterClub = () => {};
  mod.App.init();                         // wires Net.onAuthLost exactly as in the page
  const flush = async () => {
    for (let i = 0; i < 5; i++) {
      const due = timers.splice(0);
      due.forEach((fn) => fn());
      await new Promise((r) => setImmediate(r));
    }
  };
  return {
    sdk, mod, sockets, renewCalls, els, toasts, flush, timers,
    setRenewal(fn) { renewal = fn; },
    setSession(fn) { session = fn; },
    get relaunched() { return relaunched; },
  };
}

const EXPIRED = 'Your session expired. Open the game again from StarHermit to keep playing.';
const TERMS = 'StarHermit needs you to accept its updated terms. Open the game again from StarHermit to review them and keep playing.';
function relaunchShown(env, msg = EXPIRED) {
  return env.els['btn-relaunch'] && !env.els['btn-relaunch'].hidden && env.els['auth-msg'].textContent === msg;
}

test('game socket: reconnect renews first and opens with the new token', async () => {
  const env = boot();
  const g = new env.mod.GameController('s1');
  env.mod.App.game = g;
  g.connect();
  assert.equal(env.sockets.length, 1);
  assert.equal(env.sockets[0].token, T1, 'first connect uses the launch token, no renewal');
  assert.equal(env.renewCalls.length, 0);
  env.sockets[0].onclose({ code: 1006 });
  await env.flush();
  assert.equal(env.renewCalls.length, 1, 'renewed before reconnecting');
  assert.equal(env.sockets.length, 2);
  assert.equal(env.sockets[1].token, T2, 'reconnect uses the renewed token');
});

test('game socket: retry never reopens the old URL; relaunch shows Back to StarHermit', async () => {
  const env = boot();
  const g = new env.mod.GameController('s1');
  env.mod.App.game = g;
  g.connect();
  env.setRenewal(() => resp(503, null));
  env.sockets[0].onclose({ code: 1006 });
  await env.flush();
  assert.ok(env.renewCalls.length >= 1);
  assert.equal(env.sockets.length, 1, "'retry' does not reopen the old URL");
  env.setRenewal(() => resp(401, null));
  await env.flush();
  assert.equal(env.sockets.length, 1, "'relaunch' stops reconnecting");
  assert.equal(env.sdk.signedIn, false);
  assert.equal(env.mod.App.game, null, 'the game view is torn down');
  assert.ok(relaunchShown(env), 'landing card shows the expired message and Back to StarHermit');
  await env.flush();
  assert.equal(env.sockets.length, 1);
});

test('voice socket: renews before reopening; retry waits; relaunch turns voice off', async () => {
  const env = boot();
  const g = new env.mod.GameController('s1');
  const v = g.voice;
  v.enabled = true;
  v.roomId = 'room-1';
  v.connectWs();
  assert.equal(env.sockets.length, 1);
  assert.ok(env.sockets[0].url.includes('/ws/v1/voice'));
  assert.equal(env.sockets[0].token, T1);

  env.sockets[0].onclose({ code: 1006 });
  await env.flush();
  assert.equal(env.renewCalls.length, 1, 'renewed before reconnecting');
  assert.equal(env.sockets.length, 2);
  assert.equal(env.sockets[1].token, T2, 'voice URL is built from the renewed token');

  env.setRenewal(() => resp(500, null));
  env.sockets[1].onclose({ code: 1006 });
  await env.flush();
  assert.equal(env.sockets.length, 2, "'retry' does not reopen the old URL");
  assert.ok(v.enabled, 'voice keeps trying after a transient renewal failure');

  env.setRenewal(() => resp(403, {}));
  await env.flush();
  assert.equal(env.sockets.length, 2);
  assert.equal(v.enabled, false, "'relaunch' turns voice off");
  assert.ok(relaunchShown(env), 'landing card shows the expired message and Back to StarHermit');
});

test('game socket: terms consent required ends the game like auth loss', async () => {
  const env = boot();
  const g = new env.mod.GameController('s1');
  env.mod.App.game = g;
  g.connect();
  env.setRenewal(() => resp(403, { error: 'terms_acceptance_required' }));
  env.sockets[0].onclose({ code: 1006 });
  await env.flush();
  assert.equal(env.sockets.length, 1, 'no reconnect without consent');
  assert.equal(env.mod.App.game, null, 'the game view is torn down');
  assert.ok(relaunchShown(env, TERMS), 'landing card shows the terms message and Back to StarHermit');
  await env.flush();
  assert.equal(env.sockets.length, 1);
});

test('game socket: an unavailable session ends the reconnect loop with a visible note', async () => {
  const env = boot();
  const g = new env.mod.GameController('s1');
  env.mod.App.game = g;
  g.connect();
  env.setSession(() => resp(200, { sessionId: 's1', status: 'finished' }));
  env.sockets[0].onclose({ code: 1006 });
  await env.flush();
  assert.equal(env.sockets.length, 1, 'no reopen for a finished session');
  assert.equal(env.els['conn-state'].textContent, 'connection closed');
  assert.ok(env.toasts.some((t) => /no longer available/.test(t)), 'a toast explains it');
  assert.equal(env.mod.App.game, g, 'the board stays up so the player can read it');
  await env.flush();
  assert.equal(env.sockets.length, 1, 'the loop stays ended');
});

test('voice socket: terms consent required turns voice off and shows the landing card', async () => {
  const env = boot();
  const g = new env.mod.GameController('s1');
  env.mod.App.game = g;
  const v = g.voice;
  v.enabled = true;
  v.roomId = 'room-1';
  v.connectWs();
  env.setRenewal(() => resp(403, { error: 'terms_acceptance_required' }));
  env.sockets[0].onclose({ code: 1006 });
  await env.flush();
  assert.equal(env.sockets.length, 1);
  assert.equal(v.enabled, false);
  assert.equal(env.mod.App.game, null);
  assert.ok(relaunchShown(env, TERMS));
});
