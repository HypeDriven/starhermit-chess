// Unit tests for the pure graphics quality model (gfx.js). Run: node --test tests/
import '../gpu-level.js'; // window.StarHermitGpu (globalThis in Node)
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, CATEGORIES, detectPreset, detectLevel, presetForLevel, BUDGETS, resolve, presetTier, withPreset, describe } from '../gfx.js';

const desk = { webgl: true, webgl2: true, cores: 8, memoryGb: 8 };
const phone = { webgl: true, webgl2: true, mobile: true, cores: 8, memoryGb: 8 };

test('hardware level → preset: Low 0, Balanced 4, High 10, Ultra 17', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', desk), 'low');
  assert.equal(detectLevel('llvmpipe (LLVM 15.0.7, 256 bits)', desk), 0);
  assert.equal(detectPreset('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0)', desk), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)', desk), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', desk), 'balanced');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)', desk), 'high');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)', desk), 'ultra');
  assert.equal(detectLevel('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', desk), 20);
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', desk), 'ultra');
  assert.equal(detectPreset('', desk), 'balanced');
  assert.equal(presetForLevel(3), 'low');
  assert.equal(presetForLevel(16), 'high');
});

test('phones and tablets are capped at Balanced; software GPUs stay Low', () => {
  assert.equal(detectPreset('Adreno (TM) 740', phone), 'balanced');
  assert.ok(detectLevel('Adreno (TM) 740', phone) <= 9);
  assert.equal(detectPreset('NVIDIA GeForce RTX 5090', phone), 'balanced');
  assert.equal(detectPreset('Mali-G77', phone), 'low');
  assert.equal(detectPreset('SwiftShader', phone), 'low');
});

test('every preset has an explicit budget that grows from Low to Ultra and scales with the level', () => {
  const order = ['low', 'balanced', 'high', 'ultra'];
  const keys = ['dprCap', 'material', 'pieces', 'motes', 'bloomRes'];
  for (const p of order) for (const k of keys) assert.ok(BUDGETS[p][k] != null, `${p}.${k}`);
  for (let i = 1; i < order.length; i++) {
    for (const k of keys) if (typeof BUDGETS.low[k] === 'number') assert.ok(BUDGETS[order[i]][k] >= BUDGETS[order[i - 1]][k], `${order[i]}.${k}`);
  }
  const u17 = resolve({ preset: 'ultra' }, 'ultra', 17).budget;
  assert.deepEqual(resolve({ preset: 'ultra' }, 'low', 0).budget, u17, 'a manual Ultra on a weak GPU keeps the Ultra floor budget');
  const l0 = resolve({ preset: 'low' }, 'low', 0).budget, l3 = resolve({ preset: 'low' }, 'low', 3).budget;
  for (const k of keys) if (typeof l0[k] === 'number') assert.ok(l3[k] >= l0[k], `low.${k} scales up with the level`);
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
