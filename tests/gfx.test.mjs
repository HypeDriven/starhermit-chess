// Unit tests for the pure graphics quality model (gfx.js). Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, CATEGORIES, detectPreset, resolve, presetTier, withPreset, describe } from '../gfx.js';

test('detectPreset maps GPU strings to tiers', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(detectPreset('Microsoft Basic Render Driver'), 'low');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)'), 'high');
  assert.equal(detectPreset('AMD Radeon RX 6800 XT'), 'high');
  assert.equal(detectPreset('Apple M2 Pro'), 'high');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)'), 'balanced');
  assert.equal(detectPreset('AMD Radeon Graphics'), 'balanced');
  assert.equal(detectPreset('Adreno (TM) 740'), 'balanced');
  assert.equal(detectPreset(''), 'balanced');
  assert.equal(detectPreset(undefined), 'balanced');
});

test('touch devices cap Auto at balanced', () => {
  assert.equal(detectPreset('Apple M2', { mobile: true }), 'balanced');
  assert.equal(detectPreset('SwiftShader', { mobile: true }), 'low');
  assert.equal(detectPreset('Mali-G78', { mobile: true }), 'balanced');
});

test('resolve: auto follows the detected tier, an explicit preset wins', () => {
  const a = resolve({}, 'low');
  assert.equal(a.preset, 'low');
  assert.equal(a.auto, true);
  assert.equal(a.post, false, 'Low draws directly (no composer)');
  assert.equal(a.antialias, 'msaa');
  const h = resolve({ preset: 'high' }, 'low');
  assert.equal(h.preset, 'high');
  assert.equal(h.auto, false);
  assert.equal(h.bloom, 'on');
  assert.equal(h.post, true);
  assert.equal(resolve({ preset: 'bogus' }, 'balanced').preset, 'balanced');
  assert.equal(resolve(null, undefined).preset, 'balanced');
});

test('resolve: per-category overrides and invalid values', () => {
  const r = resolve({ preset: 'high', bloom: 'off', particles: 'low', grade: 'nonsense' }, 'low');
  assert.equal(r.bloom, 'off');
  assert.equal(r.particles, 'low');
  assert.equal(r.grade, presetTier('high', 'grade'));
  const noPost = resolve({ preset: 'low', antialias: 'off' }, 'low');
  assert.equal(noPost.post, false);
  assert.equal(resolve({ preset: 'low', antialias: 'fxaa' }, 'low').post, true);
});

test('resolve: render scale multiplies the preset scale and is clamped to 50-200%', () => {
  assert.equal(resolve({ preset: 'high', render_scale: 1.5 }).scale, 1.5);
  assert.equal(resolve({ preset: 'high', render_scale: 9 }).scale, 2);
  assert.equal(resolve({ preset: 'high', render_scale: 0.1 }).scale, 0.5);
  assert.equal(resolve({ preset: 'high', render_scale: 'x' }).scale, 1);
  assert.ok(Math.abs(resolve({ preset: 'ultra', render_scale: 0.5 }).scale - 0.67) < 1e-9);
});

test('resolve: adaptive defaults on, frame rate readout defaults off', () => {
  const r = resolve({}, 'low');
  assert.equal(r.adaptive, true);
  assert.equal(r.showFps, false);
  assert.equal(resolve({ adaptive: false, show_fps: true }, 'low').adaptive, false);
  assert.equal(resolve({ adaptive: false, show_fps: true }, 'low').showFps, true);
});

test('choosing a preset clears overrides but keeps scale and toggles', () => {
  const saved = { preset: 'high', bloom: 'off', detail: 'plain', render_scale: 1.25, adaptive: false, show_fps: true };
  const next = withPreset(saved, 'ultra');
  assert.deepEqual(next, { preset: 'ultra', render_scale: 1.25, adaptive: false, show_fps: true });
  const r = resolve(next, 'low');
  assert.equal(r.bloom, presetTier('ultra', 'bloom'));
  assert.equal(r.detail, 'detailed');
  assert.deepEqual(withPreset({ bloom: 'on' }, 'auto'), { preset: 'auto' });
});

test('every preset defines every category with a valid tier', () => {
  for (const p of PRESETS) {
    for (const [cat, tiers] of Object.entries(CATEGORIES)) {
      assert.ok(tiers.includes(presetTier(p, cat)), `${p}.${cat}`);
    }
  }
  assert.equal(presetTier('nope', 'bloom'), undefined);
});

test('describe summarises cost and pixels', () => {
  const s = describe(resolve({ preset: 'high' }), [1280, 800]);
  assert.match(s, /bloom/);
  assert.match(s, /SMAA/);
  assert.match(s, /1280×800 px/);
  assert.match(describe(resolve({ preset: 'low', antialias: 'off' })), /no anti-aliasing/);
});
