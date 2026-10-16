/* local.js — offline practice game against hal. No platform, no sign-in:
   the same rules (chessRules, from server.js) decide legality and the same
   greedy AI picks hal's replies, all inside this page. */
'use strict';

class LocalGame {
  constructor() {
    this.destroyed = false;
    this.g = R().newGameState();
    this.moves = [];           // [{from,to,promo,san,at}] — same shape as online
    this.myColor = Math.random() < 0.5 ? 'white' : 'black';
    this.selected = null;
    this.cands = [];
    this.status = 'active';    // active | finished
    this.result = null;
    this.sessionId = null;     // no server session, hence no replay
    this.unTick = null;
    this._aiTimer = null;
    this.voice = null;         // no voice offline; the panel stays hidden
  }

  start() {
    $('game-over').hidden = true;
    $('draw-banner').hidden = true;
    $('promo-picker').hidden = true;
    $('go-replay').hidden = true;   // replays are archived by the platform
    $('g-opp-dot').classList.add('on');
    $('g-opp-name').textContent = 'hal';
    $('g-opp-elo').textContent = '';
    $('g-me-elo').textContent = '';
    // hal doesn't chat, and voice needs the platform
    $('chat-input').disabled = true;
    $('voice-panel').hidden = true;
    this.renderSeats();

    this.unTick = UI.onTick(() => this.tickClock());
    this.render();
    if (this.g.turn !== this.myColor) this.scheduleAi();
  }

  /** Seat labels, connection note and chat placeholder in the current language. */
  renderSeats() {
    $('conn-state').textContent = T('offline practice');
    $('g-opp-dot').title = T('AI opponent');
    $('g-opp-dot').setAttribute('aria-label', T('Opponent: AI'));
    $('g-opp-color').textContent = UI.colorName(this.myColor === 'white' ? 'black' : 'white');
    $('g-me-name').textContent = T('You');
    $('g-me-color').textContent = UI.colorName(this.myColor);
    $('chat-input').placeholder = T("hal doesn't chat.");
    UI.clear($('chat-msgs'));
    $('chat-msgs').appendChild(UI.el('p', 'empty', T('Practice game — no chat.')));
  }

  /** Re-render every visible string after a language change; the game carries on. */
  relocalize() {
    this.renderSeats();
    this.render();
    this.renderGameOver();
  }

  myTurn() {
    return this.status === 'active' && this.g.turn === this.myColor;
  }

  render() {
    const flipped = this.myColor === 'black';
    const last = this.moves.length
      ? { from: R().parseSquare(this.moves[this.moves.length - 1].from), to: R().parseSquare(this.moves[this.moves.length - 1].to) }
      : null;
    const check = this.status === 'active' && R().inCheck(this.g.board, this.g.turn);
    const dests = this.cands.map(c => ({ to: c.to, cap: this.g.board[c.to] !== '.' || c.isEp }));
    UI.renderBoard($('game-board'), this.g.board, {
      flipped,
      lastMove: last,
      selected: this.selected,
      dests,
      checkSquare: check ? UI.kingSquare(this.g.board, this.g.turn) : undefined,
      onSquare: (i) => this.clickSquare(i),
    });
    $('g-check').hidden = !(check && this.g.turn === this.myColor);
    UI.renderSheet($('movesheet'), this.moves);
    const over = this.status !== 'active';
    $('btn-resign').disabled = over;
    $('btn-draw').disabled = over;
    this.tickClock();
  }

  tickClock() {
    const turnEl = $('g-turn'), clockEl = $('g-clock'), fuse = $('g-fuse');
    if (this.status !== 'active') {
      turnEl.textContent = T('Game over');
      clockEl.textContent = '';
      fuse.style.width = '0%';
      return;
    }
    turnEl.textContent = this.g.turn === this.myColor ? T('Your move') : T('{name} to move', { name: 'hal' });
    clockEl.textContent = '';        // no 24h deadline offline
    clockEl.classList.remove('urgent');
    fuse.style.width = '100%';
    fuse.classList.remove('urgent');
  }

  // ------------------------------------------------------------- interaction
  clickSquare(i) {
    if (!this.myTurn()) return;
    const matches = this.cands.filter(c => c.to === i);
    if (this.selected != null && matches.length) {
      const from = this.selected;
      if (matches.some(c => c.promo)) {
        this.showPromoPicker((promo) => this.applyMove(from, i, promo));
      } else {
        this.applyMove(from, i, null);
      }
      return;
    }
    if (this.g.board[i] !== '.' && R().pieceColor(this.g.board[i]) === this.myColor && i !== this.selected) {
      this.selected = i;
      this.cands = R().legalMovesFrom(this.g, i);
      Sfx.play('select');
    } else {
      this.selected = null;
      this.cands = [];
    }
    this.render();
  }

  applyMove(from, to, promo) {
    const req = { from: R().algebraic(from), to: R().algebraic(to), promo: promo || undefined };
    const res = R().makeMove(this.g, req, Date.now());
    this.selected = null;
    this.cands = [];
    if (!res.ok) {
      Sfx.play('illegal');
      UI.toast(UI.ruleMessage(res.error || 'Illegal move.'), 'err');
      this.render();
      return;
    }
    this.moves.push({ from: req.from, to: req.to, promo: promo || undefined, san: res.san, at: Date.now() });
    Sfx.forMove(res.san);
    this.render();
    if (res.gameOver) { this.finish(res.gameOver); return; }
    this.scheduleAi();
  }

  showPromoPicker(pick) {
    UI.promoPicker(this.myColor, pick);
  }

  // ------------------------------------------------------------- hal
  scheduleAi() {
    if (this.destroyed || this.status !== 'active') return;
    clearTimeout(this._aiTimer);
    this._aiTimer = setTimeout(() => this.aiMove(), 450 + Math.random() * 500);
  }

  aiMove() {
    if (this.destroyed || this.status !== 'active') return;
    const m = R().greedyPick(this.g, Math.random());
    if (!m) return;
    const req = { from: R().algebraic(m.from), to: R().algebraic(m.to), promo: m.promo || undefined };
    const res = R().makeMove(this.g, req, Date.now());
    if (!res.ok) return; // unreachable for a legal pick
    this.moves.push({ from: req.from, to: req.to, promo: req.promo, san: res.san, at: Date.now() });
    Sfx.forMove(res.san);
    this.render();
    if (res.gameOver) this.finish(res.gameOver);
  }

  // ------------------------------------------------------------- commands
  async resign() {
    if (this.status !== 'active') return;
    if (await UI.confirm(() => T('Resign this game?'), () => T('Resign'), true)) {
      this.finish({ kind: this.myColor === 'white' ? 'black' : 'white', reason: 'resignation' });
    }
  }

  async offerDraw() {
    if (this.status !== 'active') return;
    // hal declines instantly here exactly as the server script does online
    if (await UI.confirm(() => T('Offer a draw to {name}?', { name: 'hal' }), () => T('Offer draw'))) {
      UI.toast(T('hal declines the draw.'));
    }
  }

  sendCmd() { /* no server offline; draw offers never arrive from hal */ }
  sendChat() { /* hal doesn't chat */ }

  // ------------------------------------------------------------- game over
  finish(gameOver) {
    this.status = 'finished';
    this.result = gameOver;
    clearTimeout(this._aiTimer);
    this.render();
    this.renderGameOver();
    $('game-over').hidden = false;
    Sfx.forResult(gameOver.kind, this.myColor);
  }

  renderGameOver() {
    const r = this.result;
    if (!r) return;
    const iWon = r.kind === this.myColor;
    $('go-title').textContent = r.kind === 'draw' ? T('Drawn') : (iWon ? T('You won') : T('You lost'));
    $('go-reason').textContent = UI.reasonText(r.reason);
    $('go-elo').textContent = '';
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this._aiTimer);
    if (this.unTick) this.unTick();
    $('go-replay').hidden = false;
  }
}
