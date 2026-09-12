/**
 * StarHermit Chess — end-to-end playthrough (dev only, not shipped).
 *
 * Drives the real visible UI in headless Chrome (playwright-core + system
 * Chrome), through its own ephemeral static file server:
 *   auth/landing → "Play" (offline practice vs hal) → real square-click moves
 *   with hal replying → draw offer (hal declines via modal) → resign via
 *   confirm modal → game-over screen → back to the club.
 * Runs twice: desktop 1280x800, then a fresh context at mobile 390x844 with
 * touch. Screenshots land in /tmp/chess-e2e-<stage>-<desktop|mobile>.png.
 *
 * Platform limitation: matchmaking, rated games, invites, replays, chat and
 * voice all require the StarHermit backend (sign-in with a user token), so
 * this test covers the full offline practice path plus every screen reachable
 * without a server. server.js in this repo is the platform's authoritative
 * game script (loaded by index.html for the rules), NOT a dev server — the
 * test embeds its own static file server instead.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2', '.ts': 'video/mp2t', '.opus': 'audio/ogg', '.webp': 'image/webp',
};

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
// PORT picks the listening port (an assigned dev port); unset = ephemeral.
await new Promise((r) => server.listen(Number(process.env.PORT) || 0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// Same benign-noise filter as tools/production_game_audit.mjs
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});

const SHOT = (stage, vp) => `/tmp/chess-e2e-${stage}-${vp}.png`;

/** Pick a legal move for the side to move via the in-page rules, then click it on the real board. */
async function playOneMove(page) {
  const move = await page.evaluate(() => {
    const g = App.game;
    if (!g || !g.myTurn || !g.myTurn()) return null;
    const rules = R();
    for (let i = 0; i < 64; i++) {
      const p = g.g.board[i];
      if (p === '.' || rules.pieceColor(p) !== g.myColor) continue;
      const cands = rules.legalMovesFrom(g.g, i);
      const nonPromo = cands.find((c) => !c.promo) || cands[0];
      if (nonPromo) return { from: i, to: nonPromo.to, promo: nonPromo.promo || null };
    }
    return null;
  });
  if (!move) throw new Error('no legal move found while it was my turn');
  const plies = await page.evaluate(() => App.game.moves.length);
  await page.click(`#game-board .sq[data-i="${move.from}"]`);
  // selection must highlight destination squares before the second click
  await page.waitForSelector(`#game-board .sq[data-i="${move.to}"].dest`, { timeout: 3000 });
  await page.click(`#game-board .sq[data-i="${move.to}"]`);
  if (move.promo) {
    await page.waitForSelector('#promo-picker:not([hidden])', { timeout: 3000 });
    await page.click('#promo-picker button[aria-label="Queen"]');
  }
  await page.waitForFunction((n) => App.game.moves.length > n, plies, { timeout: 5000 });
  // hal replies after a short delay unless the game just ended
  await page.waitForFunction(
    (n) => App.game.status !== 'active' || App.game.moves.length > n,
    plies + 1, { timeout: 8000 },
  ).catch(() => {}); // mate by us ends the game without a reply
  return page.evaluate(() => ({ san: App.game.moves.map((m) => m.san).join(' '), status: App.game.status }));
}

/** The same thing again, but played entirely from the keyboard: focus a square,
 *  Enter to pick the piece up, arrows to the destination, Enter to play it. */
async function playOneMoveByKeyboard(page) {
  const move = await page.evaluate(() => {
    const g = App.game;
    if (!g || !g.myTurn || !g.myTurn()) return null;
    const rules = R();
    for (let i = 0; i < 64; i++) {
      const p = g.g.board[i];
      if (p === '.' || rules.pieceColor(p) !== g.myColor) continue;
      const nonPromo = rules.legalMovesFrom(g.g, i).find((c) => !c.promo);
      if (nonPromo) return { from: i, to: nonPromo.to, flipped: g.myColor === 'black' };
    }
    return null;
  });
  if (!move) throw new Error('no non-promoting legal move found while it was my turn');
  // visual row/col of a board index, honouring the flip for a black player
  const pos = (i) => {
    const rank = Math.floor(i / 8), file = i % 8;
    return { row: move.flipped ? rank : 7 - rank, col: move.flipped ? 7 - file : file };
  };
  const from = pos(move.from), to = pos(move.to);
  const plies = await page.evaluate(() => App.game.moves.length);

  await page.locator(`#game-board .sq[data-i="${move.from}"]`).focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector(`#game-board .sq[data-i="${move.to}"].dest`, { timeout: 3000 });
  // focus must survive the re-render the selection triggered
  const stillThere = await page.evaluate(
    (i) => document.activeElement === document.querySelector(`#game-board .sq[data-i="${i}"]`),
    move.from);
  if (!stillThere) throw new Error('board focus was lost when the selection re-rendered');
  for (let n = 0; n < Math.abs(to.col - from.col); n++)
    await page.keyboard.press(to.col > from.col ? 'ArrowRight' : 'ArrowLeft');
  for (let n = 0; n < Math.abs(to.row - from.row); n++)
    await page.keyboard.press(to.row > from.row ? 'ArrowDown' : 'ArrowUp');
  const onTarget = await page.evaluate(
    (i) => document.activeElement === document.querySelector(`#game-board .sq[data-i="${i}"]`),
    move.to);
  if (!onTarget) throw new Error('arrow keys did not land on the destination square');
  await page.keyboard.press('Enter');
  await page.waitForFunction((n) => App.game.moves.length > n, plies, { timeout: 5000 });
}

async function runPass(label, contextOpts, movePairs) {
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !browserNoise.test(m.text())) errors.push(`console: ${m.text()}`);
  });

  const step = async (name, fn) => {
    await fn();
    console.log(`ok - [${label}] ${name}`);
  };

  try {
    await step('load + auth screen visible', async () => {
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.waitForSelector('#view-auth.active', { timeout: 10000 });
      await page.waitForSelector('#btn-play-local:visible');
      await page.screenshot({ path: SHOT('auth', label) });
    });

    await step('start offline practice vs hal', async () => {
      await page.click('#btn-play-local');
      await page.waitForSelector('#view-game.active');
      await page.waitForFunction(() => App.game && App.game.status === 'active');
      const squares = await page.locator('#game-board .sq').count();
      if (squares !== 64) throw new Error(`expected 64 squares, got ${squares}`);
      const opp = await page.textContent('#g-opp-name');
      if (opp.trim() !== 'hal') throw new Error(`opponent should be hal, got "${opp}"`);
      if (await page.locator('#chat-input').isEnabled()) throw new Error('chat should be disabled offline');
      await page.screenshot({ path: SHOT('game-start', label) });
    });

    await step(`play ${movePairs} move pairs against hal`, async () => {
      for (let i = 0; i < movePairs; i++) {
        // wait until it is our turn (hal may still be thinking)
        await page.waitForFunction(
          () => App.game.status !== 'active' || App.game.myTurn(),
          null, { timeout: 10000 },
        );
        const st = await page.evaluate(() => App.game.status);
        if (st !== 'active') throw new Error(`game ended during move pair ${i + 1}`);
        const out = await playOneMove(page);
        if (i === 0) await page.screenshot({ path: SHOT('midgame', label) });
        if (i === movePairs - 1) console.log(`  moves: ${out.san}`);
      }
      const moves = await page.evaluate(() => App.game.moves.length);
      if (moves < movePairs) throw new Error('scoresheet did not advance');
      const sheet = await page.locator('#movesheet .mv').evaluateAll(
        (els) => els.filter((el) => el.textContent.trim()).length);
      if (sheet !== moves) throw new Error(`scoresheet shows ${sheet} moves, expected ${moves}`);
    });

    await step('play a move from the keyboard alone', async () => {
      await page.waitForFunction(
        () => App.game.status !== 'active' || App.game.myTurn(), null, { timeout: 10000 });
      if (await page.evaluate(() => App.game.status) !== 'active')
        throw new Error('game ended before the keyboard move');
      await playOneMoveByKeyboard(page);
    });

    await step('offer draw → hal declines', async () => {
      await page.click('#btn-draw');
      await page.waitForSelector('#modal:not([hidden])');
      await page.screenshot({ path: SHOT('draw-offer', label) });
      await page.click('#modal-ok');
      await page.waitForSelector('#modal', { state: 'hidden' });
      const st = await page.evaluate(() => App.game.status);
      if (st !== 'active') throw new Error('draw offer ended the game — hal should decline');
    });

    await step('resign via confirm modal → game over screen', async () => {
      await page.click('#btn-resign');
      await page.waitForSelector('#modal:not([hidden])');
      await page.click('#modal-ok');
      await page.waitForSelector('#game-over:not([hidden])', { timeout: 5000 });
      const title = await page.textContent('#go-title');
      const reason = await page.textContent('#go-reason');
      if (title.trim() !== 'You lost') throw new Error(`expected "You lost", got "${title}"`);
      if (!/resignation/.test(reason)) throw new Error(`expected resignation reason, got "${reason}"`);
      console.log(`  result: ${title.trim()} ${reason.trim()}`);
      await page.screenshot({ path: SHOT('game-over', label) });
    });

    await step('back to the club (auth screen, signed out)', async () => {
      await page.click('#go-menu');
      await page.waitForSelector('#view-auth.active');
    });
  } finally {
    if (errors.length) {
      await context.close();
      throw new Error(`[${label}] page errors:\n` + errors.join('\n'));
    }
    await context.close();
  }
}

try {
  await runPass('desktop', { viewport: { width: 1280, height: 800 } }, 4);
  await runPass('mobile', { viewport: { width: 390, height: 844 }, hasTouch: true }, 2);
  await runPass('landscape', { viewport: { width: 844, height: 361 }, hasTouch: true }, 1);
  console.log('\nE2E PASS — all viewport passes clean, no page errors');
} finally {
  await browser.close();
  server.close();
}
