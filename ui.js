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

  // ----------------------------------------------------------- pieces
  // Pieces are drawn as inline SVG, never as the Unicode chess glyphs. Those depend on whatever
  // font the platform picks, and U+265F (pawn) is the one of the six that Unicode also lists as
  // an emoji: iOS resolves it to Apple Color Emoji, which paints a fixed dark pawn that ignores
  // `color`, so a white player saw five white pieces and eight black pawns. A vector takes its
  // fill from CSS everywhere — .pc.w / .pc.b set `color` (the fill) and --pc-line (the outline).
  //
  // One 45x45 grid for all six, each sitting on the same plinth (y 34.5-38.5). `fill` shapes are
  // the body, `dot` circles are body-coloured too (the queen's crown balls), and `line` paths are
  // outline-coloured detail strokes.
  SVGNS: 'http://www.w3.org/2000/svg',

  PLINTH: 'M11 34.5h23l1.5 4h-26z',

  PIECE: {
    p: {
      fill: ['M22.5 7.6a5.4 5.4 0 0 1 3.8 9.2c-.7 1.2-.6 2.3.2 3.8 1.8 3.9 4.2 8.6 4.2 13.9'
        + 'h-16.4c0-5.3 2.4-10 4.2-13.9.8-1.5.9-2.6.2-3.8a5.4 5.4 0 0 1 3.8-9.2z'],
    },
    r: {
      fill: ['M11 10h5v3.2h4.2V10h4.6v3.2H29V10h5v6.5l-2.8 2.5v11.5l2.3 4h-22l2.3-4V19L11 16.5z'],
    },
    n: {
      fill: ['M14 34.5C14.4 30.1 15.5 27.1 17.6 24.7 15.5 24.5 12.6 23.9 11.1 22.4'
        + ' 10 21.3 10.3 19.8 11.6 17.9 13.3 15.5 15.6 13.7 17.6 11.5 19.2 10.4 20.4 9 20.8 7.2'
        + 'L23 9.4 25 4.6 26.3 9.6C28.8 11.2 30.5 13.5 31.2 16.8 31.8 19.8 32.1 23.6 32.1 27.6'
        + 'L32.1 34.5Z'],
      dot: [[15.6, 17.3, 1.2]],
      lineColor: true,
    },
    b: {
      fill: ['M22.5 4.6a2.6 2.6 0 0 1 1.9 4.4c3.4 2.6 5.9 6.9 5.9 11.1 0 3.4-2.1 5.9-3.9 7.6'
        + '-1 1-1.6 1.8-1.9 2.8h4l2.7 4h-17.4l2.7-4h4c-.3-1-.9-1.8-1.9-2.8-1.8-1.7-3.9-4.2-3.9-7.6'
        + ' 0-4.2 2.5-8.5 5.9-11.1a2.6 2.6 0 0 1 1.9-4.4z'],
      line: ['M19.5 19.5L25.2 13.4'],
    },
    q: {
      fill: ['M10.5 11.5L13.5 17.5 16.5 8.5 19.5 17.5 22.5 6.5 25.5 17.5 28.5 8.5 31.5 17.5'
        + ' 34.5 11.5 33.8 21.5C34.3 26 33 29.5 31.8 32L32.5 34.5H12.5L13.2 32C12 29.5 10.7 26'
        + ' 11.2 21.5Z'],
      dot: [[10.5, 11.5, 2.2], [16.5, 8.5, 2.2], [22.5, 6.5, 2.4], [28.5, 8.5, 2.2],
        [34.5, 11.5, 2.2]],
    },
    k: {
      fill: ['M21 3.5h3v3.5h3.5v3H24v4h-3v-4h-3.5v-3H21z',
        'M22.5 12.5c-4.3 0-7.5 2.8-7.5 6.4 0 2 .9 3.6 2 5-3.2-1.6-7.5-1-7.5 2.8 0 3 3.3 5 6.5 5.8'
        + 'l-1.5 2h16l-1.5-2c3.2-.8 6.5-2.8 6.5-5.8 0-3.8-4.3-4.4-7.5-2.8 1.1-1.4 2-3 2-5'
        + ' 0-3.6-3.2-6.4-7.5-6.4z'],
    },
  },

  _pieceProto: {},

  /**
   * An <svg> for a board character — uppercase is white ('Q'), lowercase black ('q').
   * Built once per character and cloned, since a board re-renders on every move.
   */
  piece(ch) {
    let proto = UI._pieceProto[ch];
    if (!proto) {
      const art = UI.PIECE[ch.toLowerCase()];
      const svg = document.createElementNS(UI.SVGNS, 'svg');
      svg.setAttribute('viewBox', '0 0 45 45');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      svg.setAttribute('class', 'pc ' + (ch === ch.toUpperCase() ? 'w' : 'b'));
      const add = (tag, attrs, cls) => {
        const n = document.createElementNS(UI.SVGNS, tag);
        for (const k in attrs) n.setAttribute(k, attrs[k]);
        if (cls) n.setAttribute('class', cls);
        svg.appendChild(n);
      };
      art.fill.forEach(d => add('path', { d: d }));
      (art.dot || []).forEach(c => add('circle', { cx: c[0], cy: c[1], r: c[2] },
        art.lineColor ? 'mk' : null));
      (art.line || []).forEach(d => add('path', { d: d }, 'ln'));
      add('path', { d: UI.PLINTH });
      proto = UI._pieceProto[ch] = svg;
    }
    return proto.cloneNode(true);
  },

  // ----------------------------------------------------------- board
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
          sq.appendChild(UI.piece(p));
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
