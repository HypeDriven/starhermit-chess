// platform.test.mjs — net.js (the chess platform layer) on top of
// starhermit-sdk.js with a stubbed fetch and launch fragment: token read,
// profile nickname, cloud-save path game:<slug> round-trip (SDK copy shipped
// with the game), settings patch, bindings, invite link, and no network at
// all standalone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installHosted, installStandalone, UID } from './starhermit-harness.mjs';

const SLUG = 'chess';
const NET_SRC = readFileSync(new URL('../net.js', import.meta.url), 'utf8');

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
function loadNet(sdk, win) {
  win.StarHermit = sdk;
  globalThis.localStorage = memStorage();
  globalThis.sessionStorage = memStorage();
  return new Function('window', NET_SRC + '\nreturn Net;')(win);
}

test('hosted: token, profile, cloud save path, settings, bindings, invite', async () => {
  const { sdk, env, win } = installHosted(SLUG);
  const Net = loadNet(sdk, win);
  assert.equal(Net.userId, UID);
  assert.equal(Net.slug, SLUG);
  assert.equal(sdk.launchSessionId, 's1');
  assert.ok(!/game_token/.test(win.history.url || ''), 'fragment stripped');
  assert.equal(globalThis.sessionStorage.getItem('chess.gameToken'), sdk.token, 'token survives a tab reload');
  assert.equal(Net.gamePath('/matchmaking'), '/api/v1/games/chess/matchmaking');

  assert.equal((await sdk.profile(UID)).displayName, 'Ada');
  assert.equal(await Net.api(`/api/v1/users/${UID}/avatar`), null, '404 resolves null');

  assert.equal(await sdk.writeSave('{"x":1}'), true);
  const put = env.calls.find((c) => c.method === 'PUT');
  assert.ok(put.url.endsWith('/cloud-saves/game%3Achess'), put.url);
  assert.deepEqual(await sdk.loadJSON(), { x: 1 });

  await sdk.patchSettings({ graphics: { preset: 'high' }, muted: true });
  assert.deepEqual(env.settings.graphics, { preset: 'high' });

  await Net.loadBindings();
  assert.equal(Net.actionFor({ code: 'Home' }), 'rowStart');
  assert.equal(Net.actionFor({ code: 'Space' }), 'select');
  assert.equal(Net.actionFor({ key: 'ArrowLeft' }), 'left');
  assert.equal(sdk.inviteLink(), `https://dashboard.starhermit.com/game-invite/${UID}/${SLUG}`);

  let lost = null;
  Net.onAuthLost = (m) => { lost = m; };
  Net.clearToken();
  assert.ok(lost && !Net.token, 'sign-out reaches onAuthLost');
  assert.equal(globalThis.sessionStorage.getItem('chess.gameToken'), null);
});

test('standalone: no token, no network', async () => {
  const st = installStandalone();
  try {
    const win = globalThis.window;
    const Net = loadNet(st.sdk, win);
    assert.equal(Net.token, null);
    await assert.rejects(Net.api('/api/v1/games/x'), (e) => e.status === 401);
    await Net.loadBindings();
    assert.equal(Net.actionFor({ code: 'ArrowUp' }), 'up');
    assert.equal(await st.sdk.loadJSON(), null);
    assert.deepEqual(await st.sdk.getSettings(), {});
    assert.equal(st.sdk.canSignIn(), false);
    assert.deepEqual(st.calls, []);
  } finally { st.restore(); }
});
