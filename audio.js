/* audio.js — sound effects. One short clip per event id, bound through
   sfx/manifest.json (name → event); the canonical human-readable table is
   sfx/manifest.txt. Everything here fails silently: a missing manifest, a
   missing clip, or a browser that refuses autoplay just means no sound.
   The top-bar Sound button mutes the lot (persisted in localStorage). */
'use strict';

const Sfx = {
  KEY: 'chess.muted',
  muted: false,
  clips: {},      // event id -> <audio>
  _btn: null,

  init() {
    try { this.muted = localStorage.getItem(this.KEY) === '1'; } catch (e) { /* storage off */ }
    this._btn = document.getElementById('btn-sound');
    if (this._btn) this._btn.addEventListener('click', () => this.toggle());
    this.renderButton();
    fetch('sfx/manifest.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        for (const e of list || []) {
          if (!e || !e.event || !e.name) continue;
          const a = new Audio('sfx/' + e.name + '.opus');
          a.preload = 'auto';
          this.clips[e.event] = a;
        }
      })
      .catch(() => { /* no manifest, no sound */ });
  },

  /** Play one event's clip from the start (restarting it if it is still going). */
  play(event) {
    if (this.muted) return;
    const a = this.clips[event];
    if (!a) return;
    try {
      a.currentTime = 0;
      const p = a.play();
      if (p && p.catch) p.catch(() => { /* autoplay refused or clip failed */ });
    } catch (e) { /* ignore */ }
  },

  /** The cue for a move that just landed, read off its SAN. */
  forMove(san) {
    const s = String(san || '');
    if (s.indexOf('=') >= 0) this.play('promote');
    else if (s.indexOf('O-O') === 0) this.play('castle');
    else if (s.indexOf('x') >= 0) this.play('capture');
    else this.play('move');
    if (/[+#]$/.test(s)) this.play('check');
  },

  /** win / lose / draw from a result {kind} and the colour I played. */
  forResult(kind, myColor) {
    if (kind === 'draw') this.play('draw');
    else this.play(kind === myColor ? 'win' : 'lose');
  },

  toggle() {
    this.muted = !this.muted;
    try { localStorage.setItem(this.KEY, this.muted ? '1' : '0'); } catch (e) { /* ignore */ }
    this.renderButton();
  },

  renderButton() {
    const b = this._btn;
    if (!b) return;
    b.textContent = this.muted ? 'Sound off' : 'Sound on';
    b.setAttribute('aria-pressed', this.muted ? 'false' : 'true');
    b.classList.toggle('on', !this.muted);
  },
};

Sfx.init();
