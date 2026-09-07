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
    $('conn-state').textContent = 'offline practice';

    $('g-opp-dot').classList.add('on');
    $('g-opp-dot').title = 'AI opponent';
    $('g-opp-dot').setAttribute('aria-label', 'Opponent AI opponent');
    $('g-opp-name').textContent = 'hal';
    $('g-opp-elo').textContent = '';
    $('g-opp-color').textContent = this.myColor === 'white' ? 'black' : 'white';
    $('g-me-name').textContent = 'You';
    $('g-me-elo').textContent = '';
    $('g-me-color').textContent = this.myColor;

    // hal doesn't chat, and voice needs the platform
    $('chat-input').disabled = true;
    $('chat-input').placeholder = "hal doesn't chat.";
    $('voice-panel').hidden = true;
    UI.clear($('chat-msgs'));
    $('chat-msgs').appendChild(UI.el('p', 'empty', 'Practice game — no chat.'));

    this.unTick = UI.onTick(() => this.tickClock());
    this.render();
    if (this.g.turn !== this.myColor) this.scheduleAi();
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
      turnEl.textContent = 'Game over';
      clockEl.textContent = '';
      fuse.style.width = '0%';
      return;
    }
    turnEl.textContent = this.g.turn === this.myColor ? 'Your move' : 'hal to move';
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
      UI.toast(res.error || 'Illegal move.', 'err');
      this.render();
      return;
    }
    this.moves.push({ from: req.from, to: req.to, promo: promo || undefined, san: res.san, at: Date.now() });
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
    this.render();
    if (res.gameOver) this.finish(res.gameOver);
  }

  // ------------------------------------------------------------- commands
  async resign() {
    if (this.status !== 'active') return;
    if (await UI.confirm('Resign this game?', 'Resign', true)) {
      this.finish({ kind: this.myColor === 'white' ? 'black' : 'white', reason: 'resignation' });
    }
  }

  async offerDraw() {
    if (this.status !== 'active') return;
    // hal declines instantly here exactly as the server script does online
    if (await UI.confirm('Offer a draw to hal?', 'Offer draw')) {
      UI.toast('hal declines the draw.');
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
    const drew = gameOver.kind === 'draw';
    const iWon = gameOver.kind === this.myColor;
    const reasons = {
      'checkmate': 'by checkmate', 'stalemate': 'by stalemate',
      'threefold-repetition': 'by threefold repetition', 'fifty-move-rule': 'by the fifty-move rule',
      'insufficient-material': 'insufficient material', 'resignation': 'by resignation',
      'agreement': 'by agreement',
    };
    $('go-title').textContent = drew ? 'Drawn' : (iWon ? 'You won' : 'You lost');
    $('go-reason').textContent = reasons[gameOver.reason] || gameOver.reason || '';
    $('go-elo').textContent = '';
    $('game-over').hidden = false;
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this._aiTimer);
    if (this.unTick) this.unTick();
    $('go-replay').hidden = false;
  }
}
