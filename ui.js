/* ui.js — DOM helpers, toasts, modal, board renderer, countdown ticker. */
'use strict';

const $ = (id) => document.getElementById(id);

const UI = {
  // ----------------------------------------------------------- dom helpers
  el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  },

  clear(node) { while (node.firstChild) node.removeChild(node.firstChild); },

  /** Round avatar: the profile picture when one exists, else the name's initial. */
  avatar(profile) {
    if (profile && profile.avatarUrl) {
      const img = UI.el('img', 'avatar');
      img.src = profile.avatarUrl;
      img.alt = '';
      return img;
    }
    const name = (profile && profile.name) || '?';
    return UI.el('span', 'avatar avatar-fallback', name.charAt(0).toUpperCase());
  },

  // ----------------------------------------------------------- toasts
  toast(msg, kind) {
    const t = UI.el('div', 'toast' + (kind ? ' ' + kind : ''), msg);
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 4200);
  },

  // ----------------------------------------------------------- modal
  _modalResolve: null,

  /** Confirm dialog. Returns Promise<boolean>. */
  confirm(text, okLabel = 'OK', danger = false) {
    return new Promise((resolve) => {
      UI._closeModal(false);
      UI._modalResolve = resolve;
      $('modal-text').textContent = text;
      UI.clear($('modal-body'));
      const ok = $('modal-ok');
      ok.textContent = okLabel;
      ok.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
      ok.hidden = false;
      $('modal-cancel').textContent = 'Cancel';
      $('modal').hidden = false;
      ok.focus();
    });
  },

  /** Modal with custom body content (e.g. a picker). Resolves null on cancel. */
  picker(text, buildBody) {
    return new Promise((resolve) => {
      UI._closeModal(null);
      UI._modalResolve = resolve;
      $('modal-text').textContent = text;
      const body = $('modal-body');
      UI.clear(body);
      buildBody(body, (value) => UI._closeModal(value));
      $('modal-ok').hidden = true;
      $('modal-cancel').textContent = 'Close';
      $('modal').hidden = false;
    });
  },

  _closeModal(value) {
    $('modal').hidden = true;
    const r = UI._modalResolve;
    UI._modalResolve = null;
    if (r) r(value);
  },

  // ----------------------------------------------------------- time
  fmtLeft(ms) {
    if (ms <= 0) return '0m';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm';
    if (m > 0) return m + 'm';
    return '<1m';
  },

  fmtDate(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  },

  fmtTime(ms) {
    const d = new Date(ms);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  },

  // ----------------------------------------------------------- ticker (1s)
  _tickFns: new Set(),
  onTick(fn) { UI._tickFns.add(fn); fn(); return () => UI._tickFns.delete(fn); },

  // ----------------------------------------------------------- board
  GLYPH: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },

  /**
   * Render a position into `container`.
   * opts: { flipped, lastMove:{from,to} (indices), selected (index), dests:[{to,cap}],
   *         checkSquare (index), onSquare(index) }
   */
  renderBoard(container, board, opts = {}) {
    const R = globalThis.chessRules;
    UI.clear(container);
    const flipped = !!opts.flipped;
    const dests = new Map();
    (opts.dests || []).forEach(d => dests.set(d.to, d));
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const rank = flipped ? row : 7 - row;
        const file = flipped ? 7 - col : col;
        const i = rank * 8 + file;
        const sq = UI.el('div', 'sq ' + ((rank + file) % 2 === 0 ? 'd' : 'l'));
        sq.dataset.i = i;
        if (opts.lastMove && (i === opts.lastMove.from || i === opts.lastMove.to)) sq.classList.add('last');
        if (opts.selected === i) sq.classList.add('sel');
        if (dests.has(i)) {
          sq.classList.add('dest');
          if (dests.get(i).cap) sq.classList.add('cap');
        }
        if (opts.checkSquare === i) sq.classList.add('chk');
        const p = board[i];
        if (p !== '.') {
          const pc = UI.el('span', 'pc ' + (p === p.toUpperCase() ? 'w' : 'b'), UI.GLYPH[p.toLowerCase()]);
          sq.appendChild(pc);
        }
        // coordinates on the visual bottom row / left column
        if (row === 7) {
          const c = UI.el('span', 'coord file', 'abcdefgh'[file]);
          sq.appendChild(c);
        }
        if (col === 0) {
          const c = UI.el('span', 'coord rank', String(rank + 1));
          sq.appendChild(c);
        }
        if (opts.onSquare) {
          sq.classList.add('clickable');
          sq.addEventListener('click', () => opts.onSquare(i));
        }
        container.appendChild(sq);
      }
    }
    void R; // rules loaded via server.js; renderer itself only needs the board string
  },

  /** Locate a king on the 64-char board string. Returns index or -1. */
  kingSquare(board, color) {
    return board.indexOf(color === 'white' ? 'K' : 'k');
  },

  /** Render a SAN move sheet. moves = [{san}], opts: {current, onJump(plyIndex)} */
  renderSheet(container, moves, opts = {}) {
    UI.clear(container);
    if (!moves.length) {
      container.appendChild(UI.el('p', 'empty', 'No moves yet.'));
      return;
    }
    for (let i = 0; i < moves.length; i += 2) {
      const row = UI.el('div', 'mvrow');
      row.appendChild(UI.el('span', 'mvnum', (i / 2 + 1) + '.'));
      for (let k = 0; k < 2; k++) {
        const ply = i + k;
        if (ply < moves.length) {
          const mv = UI.el('span', 'mv', moves[ply].san);
          if (opts.onJump) {
            mv.classList.add('jump');
            mv.addEventListener('click', () => opts.onJump(ply + 1));
          }
          if (opts.current === ply + 1) mv.classList.add('cur');
          row.appendChild(mv);
        } else row.appendChild(UI.el('span', 'mv', ''));
      }
      container.appendChild(row);
    }
    const cur = container.querySelector('.mv.cur');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
    else container.scrollTop = container.scrollHeight;
  },
};

setInterval(() => { UI._tickFns.forEach(fn => { try { fn(); } catch (e) { /* keep ticking */ } }); }, 1000);

$('modal-ok').addEventListener('click', () => UI._closeModal(true));
$('modal-cancel').addEventListener('click', () => UI._closeModal(false));

// Escape closes the modal.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('modal').hidden) UI._closeModal(false);
});
document.addEventListener('click', (e) => {
  if (e.target === $('modal')) UI._closeModal(false);
});
