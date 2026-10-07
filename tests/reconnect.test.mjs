// reconnect.test.mjs — every socket reconnect renews the launch token first
// (an expired token is refused before the upgrade, reported only as 1006, so
// reopening the same URL can never recover). Covers the SDK gameplay socket
// (GameController.connect) and the game-managed voice socket
// (VoiceController): 'renewed' reopens with the new token, 'retry' never
// reopens the old URL, 'relaunch' stops and shows "Back to StarHermit".
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
  const renewCalls = [];
  const fetchStub = async (url, init = {}) => {
    const path = String(url);
    if (path === `/api/v1/games/${SLUG}/launch-token`) { renewCalls.push(path); return renewal(); }
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
  const code = src('net.js') + '\n' + src('game.js') + '\n' + src('app.js').replace(/\nApp\.init\(\);\s*$/, '\n') +
    '\nreturn { Net, App, GameController, VoiceController };';
  const mod = new Function('window', 'document', 'navigator', 'WebSocket', 'setTimeout', 'UI', '$', 'Sfx', code)(
    win, globalThis.document, { language: 'en-US' }, WS, setT, UI, (id) => globalThis.document.getElementById(id), { play() {} });
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
    get relaunched() { return relaunched; },
  };
}

function relaunchShown(env) {
  return env.els['btn-relaunch'] && !env.els['btn-relaunch'].hidden && env.els['auth-msg'].textContent === 'Your session expired. Open the game again from StarHermit to keep playing.';
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

  env.setRenewal(() => resp(403, null));
  await env.flush();
  assert.equal(env.sockets.length, 2);
  assert.equal(v.enabled, false, "'relaunch' turns voice off");
  assert.ok(relaunchShown(env), 'landing card shows the expired message and Back to StarHermit');
});
