// settings.js — the Settings panel (top-bar button on every screen) and its Graphics section.
// Controls are built here from gfx.js so the panel always matches the quality model; every
// change goes through graphics.js, applies immediately and persists. Strings for this panel
// ship in the nine target locales (STRINGS below), chosen from navigator.languages.

import { Graphics } from './graphics.js';
import { PRESETS, CATEGORIES, PARTICLE_COUNT, presetTier } from './gfx.js';

const STRINGS = {
  'en-US': {
    settings: 'Settings', close: 'Close', graphics: 'Graphics', quality: 'Quality',
    auto: 'Auto (detected: {tier})', fromPreset: 'From preset ({tier})', renderScale: 'Render scale',
    adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
    hint: 'The 3D backdrop plays behind the club menu; board detail applies everywhere.',
    postNote: 'Post-processing is unavailable on this device, so the backdrop renders without it.',
    unknownGpu: 'unknown GPU', motes: '{n} motes', noAa: 'no anti-aliasing',
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
    unknownGpu: 'unknown GPU', motes: '{n} motes', noAa: 'no anti-aliasing',
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
    unknownGpu: 'GPU desconocida', motes: '{n} motas', noAa: 'sin antialiasing',
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
    unknownGpu: 'GPU desconocida', motes: '{n} motas', noAa: 'sin antialiasing',
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
    unknownGpu: 'unbekannte GPU', motes: '{n} Staubkörner', noAa: 'keine Kantenglättung',
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
    unknownGpu: 'GPU inconnu', motes: '{n} grains de poussière', noAa: 'sans anticrénelage',
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
    unknownGpu: 'GPU inconnu', motes: '{n} grains de poussière', noAa: 'sans anticrénelage',
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
    unknownGpu: 'GPU desconhecida', motes: '{n} partículas', noAa: 'sem antisserrilhado',
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
    unknownGpu: 'GPU sconosciuta', motes: '{n} granelli', noAa: 'senza antialiasing',
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

const locale = pickLocale(navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]);
const T = STRINGS[locale];
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

function row(labelText, control, id) {
  const wrap = document.createElement('div');
  wrap.className = control.type === 'checkbox' ? 'set-row set-toggle' : 'set-row';
  const label = document.createElement('label');
  label.className = 'set-label';
  label.htmlFor = id;
  label.textContent = labelText;
  wrap.append(label, control);
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

// Build the controls once; refresh() re-labels and re-selects them from the live state.
function build() {
  panel.setAttribute('lang', locale);
  $('settings-title').textContent = T.settings;
  $('settings-close').textContent = T.close;
  $('settings-graphics-title').textContent = T.graphics;
  $('settings-hint').textContent = T.hint;
  openBtn.querySelector('.btn-label').textContent = T.settings;
  openBtn.setAttribute('aria-label', T.settings);

  const preset = document.createElement('select');
  preset.id = 'gfx-preset';
  preset.className = 'set-select';
  preset.dataset.gfx = 'preset';
  preset.append(option('auto', ''), ...PRESETS.map((p) => option(p, T.tier[p])));
  preset.addEventListener('change', () => Graphics.setPreset(preset.value));
  body.append(row(T.quality, preset, 'gfx-preset'));

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
  body.append(row(T.renderScale, scaleWrap, 'gfx-scale'));

  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    const sel = document.createElement('select');
    sel.id = 'gfx-cat-' + cat;
    sel.className = 'set-select';
    sel.dataset.gfxCat = cat;
    sel.append(option('preset', ''), ...tiers.map((t) => option(t, T.tier[t])));
    sel.addEventListener('change', () => Graphics.set({ [cat]: sel.value }));
    body.append(row(T.cat[cat], sel, sel.id));
  }

  body.append(row(T.adaptive, toggle('gfx-adaptive', 'adaptive'), 'gfx-adaptive'));
  body.append(row(T.showFps, toggle('gfx-fps', 'show_fps'), 'gfx-fps'));
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
    r.particles === 'off' ? null : fill(T.motes, { n: PARTICLE_COUNT[r.particles] }),
    r.antialias === 'off' ? T.noAa : T.tier[r.antialias],
  ].filter(Boolean).join(', ');
  $('gfx-summary').textContent = `${Graphics.gpu || T.unknownGpu} · ${cost} · ${px[0]}×${px[1]} px`;
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
