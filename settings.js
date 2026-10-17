// settings.js — the Settings panel (top-bar button on every screen) and its Graphics section.
// Controls are built here from gfx.js so the panel always matches the quality model; every
// change goes through graphics.js, applies immediately and persists. Strings for this panel
// ship in the nine target locales (STRINGS below) and follow the game language (i18n.js:
// Settings › Language, the StarHermit account preference, then navigator.languages);
// a language change re-labels the open panel in place.

import { Graphics } from './graphics.js';
import { PRESETS, CATEGORIES, presetTier } from './gfx.js';

const STRINGS = {
  'en-US': {
    settings: 'Settings', close: 'Close', graphics: 'Graphics', quality: 'Quality',
    auto: 'Auto (detected: {tier})', fromPreset: 'From preset ({tier})', renderScale: 'Render scale',
    adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
    hint: 'The 3D backdrop plays behind the club menu; board detail applies everywhere.',
    postNote: 'Post-processing is unavailable on this device, so the backdrop renders without it.',
    unknownGpu: 'unknown GPU', level: 'Level {n}', motes: '{n} motes', noAa: 'no anti-aliasing',
    tier: { low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra', off: 'Off', on: 'On', plain: 'Plain', detailed: 'Detailed', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA' },
    cat: { bloom: 'Bloom', grade: 'Color grade', antialias: 'Anti-aliasing', reflections: 'Reflections', particles: 'Dust motes', detail: 'Board and room detail' },
    word: { reflections: 'reflections', bloom: 'bloom', grade: 'color grade' },
  },
  'en-GB': {
    settings: 'Settings', close: 'Close', graphics: 'Graphics', quality: 'Quality',
    auto: 'Auto (detected: {tier})', fromPreset: 'From preset ({tier})', renderScale: 'Render scale',
    adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
    hint: 'The 3D backdrop plays behind the club menu; board detail applies everywhere.',
    postNote: 'Post-processing is unavailable on this device, so the backdrop renders without it.',
    unknownGpu: 'unknown GPU', level: 'Level {n}', motes: '{n} motes', noAa: 'no anti-aliasing',
    tier: { low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra', off: 'Off', on: 'On', plain: 'Plain', detailed: 'Detailed', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA' },
    cat: { bloom: 'Bloom', grade: 'Colour grade', antialias: 'Anti-aliasing', reflections: 'Reflections', particles: 'Dust motes', detail: 'Board and room detail' },
    word: { reflections: 'reflections', bloom: 'bloom', grade: 'colour grade' },
  },
  'es-419': {
    settings: 'Configuración', close: 'Cerrar', graphics: 'Gráficos', quality: 'Calidad',
    auto: 'Automática (detectada: {tier})', fromPreset: 'Según el ajuste ({tier})', renderScale: 'Escala de renderizado',
    adaptive: 'Resolución adaptativa', showFps: 'Mostrar fotogramas por segundo',
    hint: 'El fondo 3D aparece detrás del menú del club; el detalle del tablero se aplica en todas partes.',
    postNote: 'El posprocesado no está disponible en este dispositivo, así que el fondo se muestra sin él.',
    unknownGpu: 'GPU desconocida', level: 'Nivel {n}', motes: '{n} motas', noAa: 'sin antialiasing',
    tier: { low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra', off: 'No', on: 'Sí', plain: 'Simple', detailed: 'Detallado', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA' },
    cat: { bloom: 'Resplandor', grade: 'Corrección de color', antialias: 'Antialiasing', reflections: 'Reflejos', particles: 'Motas de polvo', detail: 'Detalle del tablero y la sala' },
    word: { reflections: 'reflejos', bloom: 'resplandor', grade: 'corrección de color' },
  },
  'es-ES': {
    settings: 'Ajustes', close: 'Cerrar', graphics: 'Gráficos', quality: 'Calidad',
    auto: 'Automática (detectada: {tier})', fromPreset: 'Según el ajuste ({tier})', renderScale: 'Escala de renderizado',
    adaptive: 'Resolución adaptativa', showFps: 'Mostrar fotogramas por segundo',
    hint: 'El fondo 3D se ve detrás del menú del club; el detalle del tablero se aplica en todas partes.',
    postNote: 'El posprocesado no está disponible en este dispositivo, así que el fondo se muestra sin él.',
    unknownGpu: 'GPU desconocida', level: 'Nivel {n}', motes: '{n} motas', noAa: 'sin antialiasing',
    tier: { low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra', off: 'No', on: 'Sí', plain: 'Sencillo', detailed: 'Detallado', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA' },
    cat: { bloom: 'Resplandor', grade: 'Corrección de color', antialias: 'Antialiasing', reflections: 'Reflejos', particles: 'Motas de polvo', detail: 'Detalle del tablero y la sala' },
    word: { reflections: 'reflejos', bloom: 'resplandor', grade: 'corrección de color' },
  },
  'de-DE': {
    settings: 'Einstellungen', close: 'Schließen', graphics: 'Grafik', quality: 'Qualität',
    auto: 'Automatisch (erkannt: {tier})', fromPreset: 'Wie Voreinstellung ({tier})', renderScale: 'Renderauflösung',
    adaptive: 'Adaptive Auflösung', showFps: 'Bildrate anzeigen',
    hint: 'Der 3D-Hintergrund läuft hinter dem Clubmenü; Brettdetails gelten überall.',
    postNote: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar, der Hintergrund wird ohne sie gezeichnet.',
    unknownGpu: 'unbekannte GPU', level: 'Stufe {n}', motes: '{n} Staubkörner', noAa: 'keine Kantenglättung',
    tier: { low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra', off: 'Aus', on: 'An', plain: 'Schlicht', detailed: 'Detailliert', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA' },
    cat: { bloom: 'Bloom', grade: 'Farbkorrektur', antialias: 'Kantenglättung', reflections: 'Spiegelungen', particles: 'Staubkörner', detail: 'Details von Brett und Raum' },
    word: { reflections: 'Spiegelungen', bloom: 'Bloom', grade: 'Farbkorrektur' },
  },
  'fr-FR': {
    settings: 'Paramètres', close: 'Fermer', graphics: 'Graphismes', quality: 'Qualité',
    auto: 'Auto (détectée : {tier})', fromPreset: 'Selon le préréglage ({tier})', renderScale: 'Échelle de rendu',
    adaptive: 'Résolution adaptative', showFps: 'Afficher la fréquence d’images',
    hint: 'Le décor 3D s’anime derrière le menu du club ; le détail de l’échiquier s’applique partout.',
    postNote: 'Le post-traitement n’est pas disponible sur cet appareil ; le décor s’affiche sans.',
    unknownGpu: 'GPU inconnu', level: 'Niveau {n}', motes: '{n} grains de poussière', noAa: 'sans anticrénelage',
    tier: { low: 'Faible', balanced: 'Équilibrée', high: 'Élevée', ultra: 'Ultra', off: 'Non', on: 'Oui', plain: 'Simple', detailed: 'Détaillé', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA' },
    cat: { bloom: 'Halo lumineux', grade: 'Étalonnage', antialias: 'Anticrénelage', reflections: 'Reflets', particles: 'Poussière', detail: 'Détail de l’échiquier et de la salle' },
    word: { reflections: 'reflets', bloom: 'halo', grade: 'étalonnage' },
  },
  'fr-CA': {
    settings: 'Paramètres', close: 'Fermer', graphics: 'Graphismes', quality: 'Qualité',
    auto: 'Auto (détectée : {tier})', fromPreset: 'Selon le préréglage ({tier})', renderScale: 'Échelle de rendu',
    adaptive: 'Résolution adaptative', showFps: 'Afficher la fréquence d’images',
    hint: 'Le décor 3D s’anime derrière le menu du club; le détail de l’échiquier s’applique partout.',
    postNote: 'Le post-traitement n’est pas offert sur cet appareil; le décor s’affiche sans.',
    unknownGpu: 'GPU inconnu', level: 'Niveau {n}', motes: '{n} grains de poussière', noAa: 'sans anticrénelage',
    tier: { low: 'Faible', balanced: 'Équilibrée', high: 'Élevée', ultra: 'Ultra', off: 'Non', on: 'Oui', plain: 'Simple', detailed: 'Détaillé', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA' },
    cat: { bloom: 'Halo lumineux', grade: 'Étalonnage', antialias: 'Anticrénelage', reflections: 'Reflets', particles: 'Poussière', detail: 'Détail de l’échiquier et de la salle' },
    word: { reflections: 'reflets', bloom: 'halo', grade: 'étalonnage' },
  },
  'pt-BR': {
    settings: 'Configurações', close: 'Fechar', graphics: 'Gráficos', quality: 'Qualidade',
    auto: 'Automática (detectada: {tier})', fromPreset: 'Conforme a predefinição ({tier})', renderScale: 'Escala de renderização',
    adaptive: 'Resolução adaptável', showFps: 'Mostrar taxa de quadros',
    hint: 'O fundo 3D aparece atrás do menu do clube; o detalhe do tabuleiro vale em todas as telas.',
    postNote: 'O pós-processamento não está disponível neste dispositivo, então o fundo é exibido sem ele.',
    unknownGpu: 'GPU desconhecida', level: 'Nível {n}', motes: '{n} partículas', noAa: 'sem antisserrilhado',
    tier: { low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra', off: 'Não', on: 'Sim', plain: 'Simples', detailed: 'Detalhado', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA' },
    cat: { bloom: 'Brilho', grade: 'Correção de cor', antialias: 'Antisserrilhado', reflections: 'Reflexos', particles: 'Partículas de poeira', detail: 'Detalhe do tabuleiro e da sala' },
    word: { reflections: 'reflexos', bloom: 'brilho', grade: 'correção de cor' },
  },
  'it-IT': {
    settings: 'Impostazioni', close: 'Chiudi', graphics: 'Grafica', quality: 'Qualità',
    auto: 'Automatica (rilevata: {tier})', fromPreset: 'Dal preset ({tier})', renderScale: 'Scala di rendering',
    adaptive: 'Risoluzione adattiva', showFps: 'Mostra frequenza fotogrammi',
    hint: 'Lo sfondo 3D scorre dietro il menu del circolo; il dettaglio della scacchiera vale ovunque.',
    postNote: 'La post-elaborazione non è disponibile su questo dispositivo, quindi lo sfondo viene mostrato senza.',
    unknownGpu: 'GPU sconosciuta', level: 'Livello {n}', motes: '{n} granelli', noAa: 'senza antialiasing',
    tier: { low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra', off: 'No', on: 'Sì', plain: 'Semplice', detailed: 'Dettagliato', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA' },
    cat: { bloom: 'Bagliore', grade: 'Correzione colore', antialias: 'Antialiasing', reflections: 'Riflessi', particles: 'Granelli di polvere', detail: 'Dettaglio di scacchiera e sala' },
    word: { reflections: 'riflessi', bloom: 'bagliore', grade: 'correzione colore' },
  },
};

export const LOCALES = Object.keys(STRINGS);

/** Pick one of the nine locales from a navigator.languages-style list. */
export function pickLocale(langs) {
  for (const raw of langs || []) {
    const l = String(raw || '');
    const exact = LOCALES.find((k) => k.toLowerCase() === l.toLowerCase());
    if (exact) return exact;
    const lang = l.slice(0, 2).toLowerCase();
    if (lang === 'en') return /-(gb|uk|ie|au|nz|za|in)$/i.test(l) ? 'en-GB' : 'en-US';
    if (lang === 'es') return /-es$/i.test(l) ? 'es-ES' : 'es-419';
    if (lang === 'fr') return /-ca$/i.test(l) ? 'fr-CA' : 'fr-FR';
    if (lang === 'pt') return 'pt-BR';
    if (lang === 'de') return 'de-DE';
    if (lang === 'it') return 'it-IT';
  }
  return 'en-US';
}

// The game's one language source (i18n.js → sh-language.js); pickLocale only without it.
const gameLocale = () => (window.CHI18N ? window.CHI18N.lang
  : pickLocale(navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]));
let locale = gameLocale();
let T = STRINGS[locale] || STRINGS['en-US'];
const fill = (s, map) => s.replace(/\{(\w+)\}/g, (_, k) => map[k]);

const $ = (id) => document.getElementById(id);
const panel = $('settings');
const body = $('settings-graphics-body');
const openBtn = $('btn-settings');
let lastFocus = null;

function option(value, label) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  return o;
}

function row(key, control, id) {
  const wrap = document.createElement('div');
  wrap.className = control.type === 'checkbox' ? 'set-row set-toggle' : 'set-row';
  const lab = document.createElement('label');
  lab.className = 'set-label';
  lab.htmlFor = id;
  lab.dataset.setLabel = key;
  wrap.append(lab, control);
  return wrap;
}

function toggle(id, key) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.className = 'set-check';
  input.dataset.gfxToggle = key;
  input.addEventListener('change', () => Graphics.set({ [key]: input.checked }));
  return input;
}

/** Panel chrome and control labels in the current language. */
function label() {
  panel.setAttribute('lang', locale);
  $('settings-title').textContent = T.settings;
  $('settings-close').textContent = T.close;
  $('settings-graphics-title').textContent = T.graphics;
  $('settings-hint').textContent = T.hint;
  openBtn.querySelector('.btn-label').textContent = T.settings;
  openBtn.setAttribute('aria-label', T.settings);
  for (const n of body.querySelectorAll('[data-set-label]')) n.textContent = labelText(n.dataset.setLabel);
  for (const p of PRESETS) $('gfx-preset').querySelector(`option[value="${p}"]`).textContent = T.tier[p];
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    for (const t of tiers) $('gfx-cat-' + cat).querySelector(`option[value="${t}"]`).textContent = T.tier[t];
  }
}

function labelText(key) {
  return key.startsWith('cat.') ? T.cat[key.slice(4)] : T[key];
}

// Build the controls once; refresh() re-labels and re-selects them from the live state.
function build() {
  const preset = document.createElement('select');
  preset.id = 'gfx-preset';
  preset.className = 'set-select';
  preset.dataset.gfx = 'preset';
  preset.append(option('auto', ''), ...PRESETS.map((p) => option(p, '')));
  preset.addEventListener('change', () => Graphics.setPreset(preset.value));
  body.append(row('quality', preset, 'gfx-preset'));

  const scaleWrap = document.createElement('div');
  scaleWrap.className = 'set-range';
  const scale = document.createElement('input');
  scale.type = 'range'; scale.id = 'gfx-scale'; scale.min = '50'; scale.max = '200'; scale.step = '5';
  scale.dataset.gfx = 'render_scale';
  const out = document.createElement('output');
  out.id = 'gfx-scale-out';
  out.htmlFor = 'gfx-scale';
  scale.addEventListener('input', () => { out.textContent = scale.value + '%'; });
  scale.addEventListener('change', () => Graphics.set({ render_scale: Number(scale.value) / 100 === 1 ? null : Number(scale.value) / 100 }));
  scaleWrap.append(scale, out);
  body.append(row('renderScale', scaleWrap, 'gfx-scale'));

  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    const sel = document.createElement('select');
    sel.id = 'gfx-cat-' + cat;
    sel.className = 'set-select';
    sel.dataset.gfxCat = cat;
    sel.append(option('preset', ''), ...tiers.map((t) => option(t, '')));
    sel.addEventListener('change', () => Graphics.set({ [cat]: sel.value }));
    body.append(row('cat.' + cat, sel, sel.id));
  }

  body.append(row('adaptive', toggle('gfx-adaptive', 'adaptive'), 'gfx-adaptive'));
  body.append(row('showFps', toggle('gfx-fps', 'show_fps'), 'gfx-fps'));
  label();
}

function refresh() {
  const r = Graphics.resolved, s = Graphics.saved;
  const preset = $('gfx-preset');
  preset.options[0].textContent = fill(T.auto, { tier: T.tier[Graphics.detected] });
  preset.value = r.auto ? 'auto' : r.preset;
  const pct = Math.round((Number(s.render_scale) || 1) * 100);
  $('gfx-scale').value = String(Math.min(200, Math.max(50, pct)));
  $('gfx-scale-out').textContent = $('gfx-scale').value + '%';
  for (const cat of Object.keys(CATEGORIES)) {
    const sel = $('gfx-cat-' + cat);
    sel.options[0].textContent = fill(T.fromPreset, { tier: T.tier[presetTier(r.preset, cat)] });
    sel.value = CATEGORIES[cat].includes(s[cat]) ? s[cat] : 'preset';
  }
  $('gfx-adaptive').checked = r.adaptive;
  $('gfx-fps').checked = r.showFps;
  summary();
}

function summary() {
  const r = Graphics.resolved;
  const px = Graphics.info.pixels || (() => {
    const ratio = Graphics.basePixelRatio() * r.scale * (Graphics.info.adaptiveScale || 1);
    return [Math.round(window.innerWidth * ratio), Math.round(window.innerHeight * ratio)];
  })();
  const cost = [
    r.reflections === 'on' ? T.word.reflections : null,
    r.bloom === 'on' ? T.word.bloom : null,
    r.grade === 'on' ? T.word.grade : null,
    r.particles === 'off' || !r.budget.motes ? null : fill(T.motes, { n: r.budget.motes }),
    r.antialias === 'off' ? T.noAa : T.tier[r.antialias],
  ].filter(Boolean).join(', ');
  $('gfx-summary').textContent = `${Graphics.gpu || T.unknownGpu} · ${fill(T.level, { n: Graphics.level })} · ${cost} · ${px[0]}×${px[1]} px`;
  $('gfx-post-note').textContent = T.postNote;
  $('gfx-post-note').hidden = !Graphics.info.postFailed;
  panel.dataset.gfxPreset = r.preset;
}

function focusables() {
  return [...panel.querySelectorAll('button, select, input')].filter((n) => !n.disabled && n.offsetParent !== null);
}

function open() {
  lastFocus = document.activeElement;
  refresh();
  panel.hidden = false;
  openBtn.setAttribute('aria-expanded', 'true');
  $('gfx-preset').focus();
}

function close() {
  panel.hidden = true;
  openBtn.setAttribute('aria-expanded', 'false');
  if (lastFocus && lastFocus.isConnected) lastFocus.focus(); else openBtn.focus();
}

build();
document.addEventListener('ch-language', () => {
  locale = gameLocale();
  T = STRINGS[locale] || STRINGS['en-US'];
  label();
  if (!panel.hidden) refresh();
});
Graphics.subscribe((r, why) => {
  if (panel.hidden) return;
  if (why === 'info') summary(); else refresh();
});
openBtn.addEventListener('click', () => (panel.hidden ? open() : close()));
$('settings-close').addEventListener('click', close);
panel.addEventListener('click', (e) => { if (e.target === panel) close(); });
panel.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); close(); return; }
  if (e.key === 'Tab') {
    const f = focusables();
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  // Keys inside the panel belong to its controls, not to the replay stepper behind it.
  e.stopPropagation();
});
openBtn.hidden = false;

// ---- StarHermit settings KV: the graphics settings and the Sound toggle follow
// the player across devices. Signed in, the platform value wins on start (and
// on a later dev-panel sign-in); every change is patched (debounced).
const SH = window.StarHermit;
// audio.js's Sfx is a classic-script global binding (not a window property).
const sfx = () => (typeof Sfx !== 'undefined' ? Sfx : null);
let kvReady = false;
let kvLast = null;
let kvTimer = 0;
function kvPatch() {
  if (!kvReady || !SH.signedIn) return;
  const patch = { graphics: Graphics.saved, muted: !!sfx()?.muted };
  const json = JSON.stringify(patch);
  if (json === kvLast) return;
  clearTimeout(kvTimer);
  kvTimer = setTimeout(() => { kvLast = json; SH.patchSettings(patch); }, 800);
}
async function kvLoad() {
  if (!SH || !SH.signedIn) return;
  const kv = await SH.getSettings();
  if (kv.graphics && typeof kv.graphics === 'object') Graphics._commit({ ...kv.graphics });
  if (typeof kv.muted === 'boolean' && sfx()) sfx().setMuted(kv.muted);
  kvLast = JSON.stringify({ graphics: Graphics.saved, muted: !!sfx()?.muted });
  kvReady = true;
}
if (SH) {
  Graphics.subscribe((r, why) => { if (why === 'settings') kvPatch(); });
  if (sfx()) sfx().onChange = kvPatch;
  SH.on('auth', (a) => { if (a.signedIn && !kvReady) kvLoad(); if (!a.signedIn) kvReady = false; });
  kvLoad();
}
