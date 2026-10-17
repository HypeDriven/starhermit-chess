// gfx.js — graphics quality model: presets, per-category overrides, GPU detection and a
// cost summary. Pure (no three.js, no DOM), so the settings panel, the menu starfield and the
// unit tests agree on what a setting means. Shape follows root-and-ruin/web/gfx.js.

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category → allowed tiers, cheapest first. Only effects this game actually has:
// the WebGL starfield behind the club menu and the DOM board / landing room.
export const CATEGORIES = {
  bloom: ['off', 'on'],                       // starfield: highlights and lamp motes glow
  grade: ['off', 'on'],                       // starfield: S-curve, warm/cool split, vignette
  antialias: ['off', 'fxaa', 'smaa', 'msaa'], // starfield edges
  reflections: ['off', 'on'],                 // starfield: room-light IBL + lacquered clearcoat
  particles: ['off', 'low', 'high'],          // starfield: dust motes drifting in the lamp light
  detail: ['plain', 'detailed'],              // DOM: wood-grain board, bevelled frame, lamp glow
};

// Each preset is a row of tiers plus a render scale (multiplies the capped device pixel ratio).
// Low reproduces the pre-upgrade starfield exactly (canvas MSAA, no post, plain board).
const TABLE = {
  low: { scale: 1, bloom: 'off', grade: 'off', antialias: 'msaa', reflections: 'off', particles: 'off', detail: 'plain' },
  balanced: { scale: 0.9, bloom: 'on', grade: 'on', antialias: 'fxaa', reflections: 'on', particles: 'low', detail: 'detailed' },
  high: { scale: 1, bloom: 'on', grade: 'on', antialias: 'smaa', reflections: 'on', particles: 'high', detail: 'detailed' },
  ultra: { scale: 1.34, bloom: 'on', grade: 'on', antialias: 'msaa', reflections: 'on', particles: 'high', detail: 'detailed' },
};

export const PARTICLE_COUNT = { off: 0, low: 70, high: 180 };

// Auto picks the preset from the StarHermit hardware level (0 = Galaxy S20 / Intel UHD, 20 = RTX 5090;
// gpu-level.js → window.StarHermitGpu): Low from 0, Balanced from 4, High from 10, Ultra from 17.
// Phones, tablets and ≤ 4 GB machines are capped at level 9 (Balanced); software renderers are level 0.
export const PRESET_LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };

function gpuApi() { return globalThis.StarHermitGpu; }

/** Hardware level (0–20) for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
export function detectLevel(gpu, system) {
  const G = gpuApi();
  if (!G) return PRESET_LEVELS.balanced;
  return G.detectLevel({ ...(system || {}), gpu: String(gpu || '') });
}

/** The preset Auto starts from for a hardware level. */
export function presetForLevel(level) {
  const G = gpuApi();
  if (G) return G.presetForLevel(level, PRESET_LEVELS);
  return level >= 17 ? 'ultra' : level >= 10 ? 'high' : level >= 4 ? 'balanced' : 'low';
}

/** Best preset for this GPU (the level already caps phones/tablets at Balanced). */
export function detectPreset(gpu, system) {
  return presetForLevel(detectLevel(gpu, system));
}

/** Scale a count tuned at the preset's floor level up for faster GPUs (≤ 4×, never below the floor budget). */
export function scaleCount(n, preset, level) {
  const G = gpuApi();
  const floor = PRESET_LEVELS[preset] || 0;
  return Math.round(G ? G.scaleBudget(n, Math.max(Number(level) || 0, floor), floor) : n);
}

/**
 * Per-preset asset and effect budget for the menu starfield (the game's only WebGL scene). Each preset
 * is tuned to hold 60 FPS on the weakest GPU Auto gives it (Low → hardware level 0, Balanced → 4,
 * High → 10, Ultra → 17; measured with tests/gfx-bench.mjs).
 *   dprCap     device-pixel-ratio ceiling (before the preset's render scale);
 *   material   'lambert' | 'standard' for unlacquered pieces (Reflections on = lacquered Physical);
 *   pieces     drifting piece instances as a multiple of the base field (120 on small screens, 210 above);
 *   motes      dust motes at the floor level (the Particles tier caps them: off 0, low 70);
 *   bloomRes   bloom resolution as a fraction of the frame.
 * Counts scale up within the preset on faster GPUs (StarHermitGpu.scaleBudget, ≤ 4×, never below the floor).
 */
export const BUDGETS = {
  low: { dprCap: 1, material: 'lambert', pieces: 0.6, motes: 0, bloomRes: 0.5 },
  balanced: { dprCap: 1.5, material: 'standard', pieces: 1, motes: 70, bloomRes: 0.5 },
  high: { dprCap: 2, material: 'standard', pieces: 1.3, motes: 180, bloomRes: 0.5 },
  ultra: { dprCap: 2, material: 'standard', pieces: 1.6, motes: 260, bloomRes: 1 },
};
export const MAX_PIECES = 2.4; // instance buffers are allocated for this multiple of the base field
export const MAX_MOTES = 400;

/** A preset's concrete budget for a hardware level and Particles tier. */
export function budgetFor(preset, level, particles = 'off') {
  const b = { ...(BUDGETS[preset] || BUDGETS.balanced) };
  b.pieces = Math.min(MAX_PIECES, Math.round(scaleCount(b.pieces * 100, preset, level)) / 100);
  const cap = particles === 'high' ? MAX_MOTES : PARTICLE_COUNT[particles] || 0;
  b.motes = Math.min(cap, scaleCount(b.motes || PARTICLE_COUNT[particles] || 0, preset, level));
  return b;
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected, level) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const out = { preset, auto, scale: row.scale * clamp(Number(s.render_scale) || 1, 0.5, 2) };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
  out.budget = budgetFor(preset, level, out.particles);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // Post-processing runs only when something needs it; otherwise the canvas draws directly.
  out.post = out.bloom === 'on' || out.grade === 'on' || out.antialias === 'fxaa' || out.antialias === 'smaa';
  return out;
}

/** New saved settings after picking a preset: overrides are cleared, scale/toggles kept. */
export function withPreset(saved, preset) {
  const s = saved || {};
  const out = { preset: PRESETS.includes(preset) ? preset : 'auto' };
  if (s.render_scale != null) out.render_scale = s.render_scale;
  if (s.adaptive === false) out.adaptive = false;
  if (s.show_fps) out.show_fps = true;
  return out;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  return TABLE[preset]?.[cat];
}

/** Short English cost summary (the panel localizes its own words; this is for logs/tests). */
export function describe(r, pixels) {
  const parts = [
    r.reflections === 'on' ? 'reflections' : null,
    r.bloom === 'on' ? 'bloom' : null,
    r.grade === 'on' ? 'grade' : null,
    r.particles === 'off' ? null : `${PARTICLE_COUNT[r.particles]} motes`,
    r.antialias === 'off' ? 'no anti-aliasing' : r.antialias.toUpperCase(),
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
