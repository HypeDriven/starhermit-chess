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
  balanced: { scale: 1, bloom: 'on', grade: 'on', antialias: 'fxaa', reflections: 'on', particles: 'low', detail: 'detailed' },
  high: { scale: 1, bloom: 'on', grade: 'on', antialias: 'smaa', reflections: 'on', particles: 'high', detail: 'detailed' },
  ultra: { scale: 1.34, bloom: 'on', grade: 'on', antialias: 'msaa', reflections: 'on', particles: 'high', detail: 'detailed' },
};

export const PARTICLE_COUNT = { off: 0, low: 70, high: 180 };

/** Best preset for this GPU, from the unmasked renderer string when the browser exposes it. */
export function detectPreset(gpu, { mobile = false } = {}) {
  const g = String(gpu || '').toLowerCase();
  let p = 'balanced';
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(g)) p = 'low';
  else if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|amd radeon(?! graphics)|apple m\d/.test(g)) p = 'high';
  // Phones and tablets: Auto never goes above Balanced (heat and battery).
  if (mobile && PRESETS.indexOf(p) > PRESETS.indexOf('balanced')) p = 'balanced';
  return p;
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const out = { preset, auto, scale: row.scale * clamp(Number(s.render_scale) || 1, 0.5, 2) };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
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
