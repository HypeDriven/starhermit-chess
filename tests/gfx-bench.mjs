// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only). The board is DOM; the game's only WebGL
// scene is the club-menu starfield (3D pieces drifting through lamp light, dust motes, post chain).
// The preset is picked in the real Settings panel, then the page signs in through the stubbed
// StarHermit API (as tests/e2e.mjs does) so the real menu — and its starfield — is on screen.
import { stubStarHermit, launchToken } from './starhermit-e2e.mjs';

export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  await page.waitForSelector('#view-auth.active', { timeout: 20000 });
  await page.click('#btn-settings');
  await page.waitForSelector('#settings:not([hidden])');
  await page.selectOption('#gfx-preset', preset);
  await page.waitForFunction((p) => document.documentElement.dataset.gfxPreset === p, preset);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#settings', { state: 'hidden' });
}

export async function start(page, { preset }) {
  await stubStarHermit(page, {});
  const url = new URL(page.url());
  await page.goto(`${url.origin}/index.html#game_token=${launchToken()}`, { waitUntil: 'load' });
  await page.waitForSelector('#view-menu.active', { timeout: 20000 });
  await page.waitForSelector(`#starfield[data-gfx-preset="${preset}"]:not([hidden])`, { timeout: 30000 });
  await page.waitForTimeout(500);
}
