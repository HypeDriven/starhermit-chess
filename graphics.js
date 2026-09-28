// graphics.js — the live graphics settings store. Loads/saves `chess.graphics` in localStorage,
// detects the GPU once, resolves settings through gfx.js and publishes them: to the DOM as
// data attributes (`data-gfx-preset`, `data-gfx-detail` on <html>, which style.css keys the
// board/room detail off) and to subscribers (the menu starfield, the settings panel).

import { resolve, detectPreset, withPreset } from './gfx.js';

const KEY = 'chess.graphics';
const listeners = new Set();
const reducedQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
}

function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* storage off: session only */ }
}

// The unmasked renderer string. Firefox already reports it through RENDERER (and deprecates
// the debug extension with a console warning), so the extension is only asked when RENDERER
// is the generic "WebKit WebGL" mask. The probe context is simply dropped afterwards.
function detectGpu() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    let name = String(gl.getParameter(gl.RENDERER) || '');
    if (!name || /^(webkit|mozilla)/i.test(name)) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) name = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || name);
    }
    return name;
  } catch (e) {
    return '';
  }
}

const mobile = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
const gpu = detectGpu();

export const Graphics = {
  gpu,
  detected: detectPreset(gpu, { mobile }),
  saved: load(),
  resolved: null,
  // What the starfield last reported: canvas pixels, post-processing failure, adaptive scale.
  info: { pixels: null, postFailed: false, adaptiveScale: 1 },

  get reducedMotion() { return !!(reducedQuery && reducedQuery.matches); },

  /** Base device pixel ratio for WebGL: capped at 1.5 (the pre-upgrade starfield's cap). */
  basePixelRatio() { return Math.min(window.devicePixelRatio || 1, 1.5); },

  subscribe(fn) { listeners.add(fn); fn(this.resolved, 'settings'); return () => listeners.delete(fn); },

  /** Merge `patch` into the saved settings ('preset' as a category value removes the override). */
  set(patch) {
    const s = { ...this.saved };
    for (const [k, v] of Object.entries(patch)) {
      if (v === 'preset' || v == null) delete s[k]; else s[k] = v;
    }
    this._commit(s);
  },

  /** Pick a preset ('auto' or a tier); clears every per-category override. */
  setPreset(p) { this._commit(withPreset(this.saved, p)); },

  report(info) {
    Object.assign(this.info, info);
    for (const fn of listeners) fn(this.resolved, 'info');
  },

  _commit(s) {
    this.saved = s;
    save(s);
    this._apply();
  },

  _apply() {
    const r = this.resolved = resolve(this.saved, this.detected);
    const root = document.documentElement;
    root.dataset.gfxPreset = r.preset;
    root.dataset.gfxAuto = r.auto ? '1' : '0';
    root.dataset.gfxDetail = r.detail;
    fpsMeter(r.showFps);
    for (const fn of listeners) fn(r, 'settings');
  },
};

// Frame-rate readout: its own rAF counter so it works on every screen (the board is DOM),
// running only while the toggle is on.
let fpsRaf = 0;
function fpsMeter(on) {
  let el = document.getElementById('fps-meter');
  if (on && !el) {
    el = document.createElement('div');
    el.id = 'fps-meter';
    el.className = 'fps-meter';
    el.setAttribute('aria-hidden', 'true');
    document.body.append(el);
  }
  if (el) el.hidden = !on;
  if (!on) { if (fpsRaf) cancelAnimationFrame(fpsRaf); fpsRaf = 0; return; }
  if (fpsRaf) return;
  let frames = 0, t0 = performance.now();
  const tick = (t) => {
    frames++;
    if (t - t0 >= 1000) {
      el.textContent = `${Math.round((frames * 1000) / (t - t0))} fps`;
      frames = 0; t0 = t;
    }
    fpsRaf = requestAnimationFrame(tick);
  };
  el.textContent = '… fps';
  fpsRaf = requestAnimationFrame(tick);
}

if (reducedQuery && reducedQuery.addEventListener) {
  reducedQuery.addEventListener('change', () => { for (const fn of listeners) fn(Graphics.resolved, 'motion'); });
}

Graphics._apply();
window.ChessGraphics = Graphics; // debugging aid; tests drive the visible panel instead
