/* app.js — boot/auth, main menu (matchmaking, sessions, leaderboard, replays,
   invites) and the replay viewer. Views are plain sections toggled here. */
'use strict';

const App = {
  info: null,            // GET /games/chess payload
  lastElo: null,
  currentView: null,
  game: null,            // active GameController
  replay: null,          // replay viewer state
  _menuTimers: [],
  _mmTimer: null,
  _onLeave: null,

  // ------------------------------------------------------------- views
  showView(name) {
    if (this._onLeave) { this._onLeave(); this._onLeave = null; }
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    $('view-' + name).classList.add('active');
    this.currentView = name;
  },

  updateEloChip(elo) {
    const chip = $('top-elo');
    if (elo == null) { chip.hidden = true; return; }
    chip.hidden = false;
    chip.textContent = 'Elo ' + elo;
  },

  // ------------------------------------------------------------- boot/auth
  init() {
    Net.onAuthLost = (msg) => {
      if (App.game) { App.game.destroy(); App.game = null; }
      App.showAuth(msg);
    };

    // #game_token=<jwt> from the platform launcher — read once, strip from URL.
    const m = location.hash.match(/[#&]game_token=([^&]+)/);
    if (m) {
      history.replaceState(null, '', location.pathname + location.search);
      Net.setToken(decodeURIComponent(m[1]));
      this.enterClub();
      return;
    }
    if (Net.token) {
      const claims = Net.decodeJwt(Net.token);
      if (claims && (!claims.exp || claims.exp * 1000 > Date.now() + 60000)) {
        Net.setToken(Net.token); // populates userId
        this.enterClub();
        return;
      }
      Net.clearToken();
    }
    this.showAuth();
  },

  showAuth(msg) {
    const box = $('auth-msg');
    box.hidden = !msg;
    if (msg) box.textContent = msg;
    $('auth-base').value = Net.base;
    this.updateEloChip(null);
    this.showView('auth');
  },

  async authSubmit() {
    const jwt = $('auth-jwt').value.trim();
    const base = $('auth-base').value.trim() || 'http://localhost:5050';
    if (!jwt) { this.showAuth('Paste a user token first.'); return; }
    Net.setBase(base);
    const btn = $('auth-go');
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      await Net.launchToken(jwt);
      this.enterClub();
    } catch (e) {
      this.showAuth(e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Enter the club';
    }
  },

  enterClub() {
    Net.startRefresh();
    this.showMenu();
  },

  // ------------------------------------------------------------- menu
  showMenu() {
    if (this.game) { this.game.destroy(); this.game = null; }
    this.showView('menu');
    this._onLeave = () => this.stopMenuTimers();
    this.refreshMenu();
    this._menuTimers.push(setInterval(() => this.loadInvites(), 10000));
    this._menuTimers.push(setInterval(() => this.loadSessions(), 30000));
    this._menuTimers.push({ untick: UI.onTick(() => this.tickSessionCards()) });
  },

  stopMenuTimers() {
    for (const t of this._menuTimers) {
      if (t && t.untick) t.untick(); else clearInterval(t);
    }
    this._menuTimers = [];
    this.stopMatchmakingUi(false);
  },

  refreshMenu() {
    this.loadGameInfo().then(() => this.loadLeaderboard());
    this.loadSessions();
    this.loadReplays();
    this.loadInvites();
  },

  async loadGameInfo() {
    try {
      this.info = await Net.api('/api/v1/games/chess');
      const me = this.info.me || {};
      this.lastElo = me.elo != null ? me.elo : this.lastElo;
      this.updateEloChip(me.elo);
      const body = $('lb-me');
      UI.clear(body);
      const elo = UI.el('div', 'rating-elo', String(me.elo != null ? me.elo : '—'));
      const rec = UI.el('div', 'rating-rec',
        (me.wins || 0) + ' won · ' + (me.losses || 0) + ' lost · ' + (me.draws || 0) + ' drawn');
      body.appendChild(elo);
      body.appendChild(rec);
    } catch (e) {
      if (e.status !== 401) UI.toast(e.message, 'err');
    }
  },

  // ---- sessions
  async loadSessions() {
    let sessions;
    try {
      sessions = await Net.api('/api/v1/games/chess/sessions/mine') || [];
    } catch (e) {
      if (e.status !== 401) $('sessions-list').replaceChildren(UI.el('p', 'empty', 'Could not load games — ' + e.message));
      return;
    }
    const active = sessions.filter(s => s.status === 'active');
    const cap = (this.info && this.info.maxConcurrentSessionsPerPlayer) || 20;
    $('sessions-count').textContent = active.length + ' of ' + cap + ' seats';
    const list = $('sessions-list');
    UI.clear(list);
    if (!active.length) {
      list.appendChild(UI.el('p', 'empty', 'No games yet — hit Play, or invite a friend.'));
      return;
    }
    active.sort((a, b) => (b.myTurn === true) - (a.myTurn === true) || (a.deadline || 0) - (b.deadline || 0));
    for (const s of active) {
      const opp = (s.players || []).find(p => p.userId !== Net.userId);
      const card = UI.el('button', 'card');
      card.appendChild(UI.el('span', 'card-name', opp ? opp.username : 'Unknown opponent'));
      const sub = UI.el('span', 'card-sub');
      sub.dataset.deadline = s.deadline || '';
      sub.dataset.myturn = s.myTurn === true ? '1' : '';
      card.appendChild(sub);
      card.appendChild(UI.el('span', 'spacer'));
      const turn = UI.el('span', 'card-turn' + (s.myTurn === true ? ' mine' : ''),
        s.myTurn === true ? 'your move' : 'their move');
      card.appendChild(turn);
      card.addEventListener('click', () => this.openGame(s.sessionId));
      list.appendChild(card);
    }
    this.tickSessionCards();
  },

  tickSessionCards() {
    document.querySelectorAll('#sessions-list .card-sub').forEach(el => {
      const dl = Number(el.dataset.deadline);
      if (!dl) { el.textContent = ''; return; }
      const left = dl - Date.now();
      const whose = el.dataset.myturn ? 'your move' : 'their move';
      UI.clear(el);
      const span = UI.el('span', left < 3600000 ? 'urgent' : null, UI.fmtLeft(left) + ' left');
      el.appendChild(document.createTextNode(whose + ' — '));
      el.appendChild(span);
    });
  },

  // ---- matchmaking
  async startMatchmaking() {
    try {
      const r = await Net.api('/api/v1/games/chess/matchmaking', { method: 'POST' });
      if (r.status === 'matched' && r.sessionId) { this.openGame(r.sessionId); return; }
      this.showMatchmakingUi(true);
      this._mmTimer = setInterval(() => this.pollMatchmaking(), 3000);
    } catch (e) {
      if (e.status === 409) UI.toast('Cannot queue: ' + e.message, 'err');
      else if (e.status !== 401) UI.toast(e.message, 'err');
    }
  },

  async pollMatchmaking() {
    try {
      const r = await Net.api('/api/v1/games/chess/matchmaking');
      if (r && r.status === 'matched' && r.sessionId) {
        this.stopMatchmakingUi(false);
        UI.toast('Opponent found — good luck.', 'ok');
        this.openGame(r.sessionId);
      }
    } catch (e) {
      if (e.status === 404) { this.stopMatchmakingUi(false); this.loadSessions(); }
    }
  },

  async cancelMatchmaking() {
    this.stopMatchmakingUi(false);
    try { await Net.api('/api/v1/games/chess/matchmaking', { method: 'DELETE' }); }
    catch (e) { /* already gone */ }
  },

  showMatchmakingUi(on) {
    $('play-idle').hidden = on;
    $('play-searching').hidden = !on;
  },

  stopMatchmakingUi(keepUi) {
    if (this._mmTimer) { clearInterval(this._mmTimer); this._mmTimer = null; }
    if (!keepUi) this.showMatchmakingUi(false);
  },

  // ---- leaderboard
  async loadLeaderboard() {
    const holder = $('lb-table');
    if (!this.info || !this.info.leaderboardId) return;
    try {
      const j = await Net.api(`/api/v1/leaderboards/${this.info.leaderboardId}/entries?friendsOnly=true&page=1&pageSize=10`);
      const entries = (j && (j.entries || j.items)) || (Array.isArray(j) ? j : []);
      UI.clear(holder);
      if (!entries.length) { holder.appendChild(UI.el('p', 'empty', 'No rated friends yet.')); return; }
      const table = UI.el('table', 'lb');
      for (const e of entries) {
        const tr = UI.el('tr', e.userId === Net.userId ? 'me' : null);
        tr.appendChild(UI.el('td', 'lb-rank', String(e.rank != null ? e.rank : '')));
        tr.appendChild(UI.el('td', null, e.username || String(e.userId).slice(0, 8)));
        tr.appendChild(UI.el('td', 'lb-score', String(e.score)));
        table.appendChild(tr);
      }
      holder.appendChild(table);
    } catch (e) {
      if (e.status !== 401) holder.replaceChildren(UI.el('p', 'empty', 'Table unavailable.'));
    }
  },

  // ---- replays
  async loadReplays() {
    const list = $('replays-list');
    let replays;
    try {
      replays = await Net.api('/api/v1/games/chess/replays/mine?limit=10') || [];
    } catch (e) {
      if (e.status !== 401) list.replaceChildren(UI.el('p', 'empty', 'No archive available.'));
      return;
    }
    UI.clear(list);
    if (!replays.length) {
      list.appendChild(UI.el('p', 'empty', 'Finished games will be filed here.'));
      return;
    }
    replays.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
    for (let i = 0; i < replays.length; i++) {
      const r = replays[i];
      // The result record carries the rating change directly (eloBefore/eloAfter by userId).
      const res = r.result || {};
      const myAfter = res.eloAfter ? res.eloAfter[Net.userId] : null;
      const myBefore = res.eloBefore ? res.eloBefore[Net.userId] : null;
      const delta = (myAfter != null && myBefore != null) ? myAfter - myBefore : null;
      const opp = (r.players || []).find(p => p.userId !== Net.userId);
      const card = UI.el('button', 'card');
      const name = UI.el('span', 'card-name', opp ? opp.username : '?');
      const kind = r.result ? r.result.kind : null;
      const resTxt = kind === 'draw' ? 'draw' : (kind ? kind + ' won' : '');
      const sub = UI.el('span', 'card-sub',
        [resTxt, r.result && r.result.reason, UI.fmtDate(r.finishedAt)].filter(Boolean).join(' · '));
      card.appendChild(name);
      card.appendChild(sub);
      card.appendChild(UI.el('span', 'spacer'));
      if (delta != null) {
        card.appendChild(UI.el('span', 'card-sub ' + (delta >= 0 ? 'delta-up' : 'delta-down'),
          (delta >= 0 ? '+' : '') + delta));
      } else if (myAfter != null) {
        card.appendChild(UI.el('span', 'card-sub', String(myAfter)));
      }
      card.addEventListener('click', () => this.openReplay(r.sessionId));
      list.appendChild(card);
    }
  },

  // ---- invites
  async loadInvites() {
    let j;
    try { j = await Net.api('/api/v1/games/chess/invites'); }
    catch (e) { return; }
    const list = $('invites-list');
    UI.clear(list);
    const incoming = (j && j.incoming) || [];
    const outgoing = ((j && j.outgoing) || []).filter(o => o.status === 'pending');
    if (!incoming.length && !outgoing.length) {
      list.appendChild(UI.el('p', 'empty', 'No invitations.'));
      return;
    }
    for (const inv of incoming) {
      const card = UI.el('div', 'card card-static');
      card.appendChild(UI.el('span', 'card-name', inv.from ? inv.from.username : '?'));
      card.appendChild(UI.el('span', 'card-sub', 'invites you to a game'));
      card.appendChild(UI.el('span', 'spacer'));
      const acc = UI.el('button', 'btn btn-small btn-primary', 'Accept');
      acc.addEventListener('click', async () => {
        try {
          const r = await Net.api(`/api/v1/games/chess/invites/${inv.inviteId}/accept`, { method: 'POST' });
          if (r && r.sessionId) this.openGame(r.sessionId);
        } catch (e) { UI.toast('Could not accept: ' + e.message, 'err'); this.loadInvites(); }
      });
      const dec = UI.el('button', 'btn btn-small', 'Decline');
      dec.addEventListener('click', async () => {
        try { await Net.api(`/api/v1/games/chess/invites/${inv.inviteId}/decline`, { method: 'POST' }); }
        catch (e) { /* gone */ }
        this.loadInvites();
      });
      card.appendChild(acc);
      card.appendChild(dec);
      list.appendChild(card);
    }
    for (const inv of outgoing) {
      const card = UI.el('div', 'card card-static');
      card.appendChild(UI.el('span', 'card-name', inv.to ? inv.to.username : '?'));
      card.appendChild(UI.el('span', 'card-sub', 'invited — waiting'));
      list.appendChild(card);
    }
  },

  async inviteFriend() {
    let friends;
    try {
      const j = await Net.api('/api/v1/me/friends');
      friends = Array.isArray(j) ? j : (j && (j.friends || j.items)) || [];
    } catch (e) {
      UI.toast('Could not load friends: ' + e.message, 'err');
      return;
    }
    await UI.picker('Invite a friend to a game', (body, close) => {
      if (!friends.length) {
        body.appendChild(UI.el('p', 'empty', 'No friends on the platform yet.'));
        return;
      }
      for (const f of friends) {
        const id = f.userId || f.id;
        const card = UI.el('button', 'card');
        card.appendChild(UI.el('span', 'card-name', f.username || String(id).slice(0, 8)));
        card.appendChild(UI.el('span', 'spacer'));
        card.appendChild(UI.el('span', 'card-sub', 'Invite'));
        card.addEventListener('click', async () => {
          close(null);
          try {
            await Net.api('/api/v1/games/chess/invites', { method: 'POST', body: { toUserId: id } });
            UI.toast('Invitation sent to ' + (f.username || 'your friend') + '.', 'ok');
            this.loadInvites();
          } catch (e) {
            UI.toast('Could not invite: ' + e.message, 'err');
          }
        });
        body.appendChild(card);
      }
    });
  },

  // ------------------------------------------------------------- game
  openGame(sessionId) {
    this.showView('game');
    if (this.game) this.game.destroy();
    this.game = new GameController(sessionId);
    this._onLeave = () => { if (this.game) { this.game.destroy(); this.game = null; } };
    this.game.start();
  },

  // ------------------------------------------------------------- replay viewer
  async openReplay(sessionId) {
    let raw;
    try {
      raw = await Net.api(`/api/v1/games/chess/replays/${sessionId}`);
    } catch (e) {
      UI.toast('Could not open the replay: ' + e.message, 'err');
      return;
    }
    // The platform archives the script-owned session state verbatim under `state`;
    // unpack the chess shape (white/black/moves) from it.
    const st = raw.state || {};
    const data = {
      players: raw.players || [],
      result: raw.result || st.result || null,
      white: st.white,
      black: st.black,
      moves: (st.game && st.game.moves) || [],
    };
    const eloAfter = data.result && data.result.eloAfter;

    const Rules = R();
    const states = [{ board: Rules.START_BOARD, turn: 'white', check: false, lastMove: null }];
    const g = Rules.newGameState();
    for (const m of data.moves || []) {
      Rules.makeMove(g, { from: m.from, to: m.to, promo: m.promo || undefined }, m.at || 0);
      states.push({
        board: g.board, turn: g.turn,
        check: Rules.inCheck(g.board, g.turn),
        lastMove: { from: Rules.parseSquare(m.from), to: Rules.parseSquare(m.to) },
      });
    }
    const names = {};
    for (const p of data.players || []) names[p.userId] = p.username;
    const flipped = data.black === Net.userId;
    this.replay = { data, states, idx: states.length - 1, flipped, names, eloAfter };

    // seats: bottom = my side (or white when spectating)
    const botId = flipped ? data.black : data.white;
    const topId = flipped ? data.white : data.black;
    $('r-bot-name').textContent = names[botId] || '?';
    $('r-bot-color').textContent = flipped ? 'black' : 'white';
    $('r-top-name').textContent = names[topId] || '?';
    $('r-top-color').textContent = flipped ? 'white' : 'black';

    const res = data.result || {};
    const winnerName = res.kind === 'white' ? names[data.white] : (res.kind === 'black' ? names[data.black] : null);
    $('r-result').textContent = res.kind
      ? (res.kind === 'draw' ? 'Drawn' : (winnerName || res.kind) + ' won') + ' — ' + (res.reason || '')
      : 'In progress';
    $('r-elo').textContent = eloAfter
      ? (data.players || []).map(p => (names[p.userId] || '?') + ' ' + (eloAfter[p.userId] != null ? eloAfter[p.userId] : '—')).join(' · ')
      : '';

    this.showView('replay');
    this._onLeave = () => { this.replay = null; };
    this.renderReplay();
  },

  renderReplay() {
    const rp = this.replay;
    if (!rp) return;
    const st = rp.states[rp.idx];
    UI.renderBoard($('r-board'), st.board, {
      flipped: rp.flipped,
      lastMove: st.lastMove,
      checkSquare: st.check ? UI.kingSquare(st.board, st.turn) : undefined,
    });
    UI.renderSheet($('r-moves'), rp.data.moves || [], {
      current: rp.idx,
      onJump: (ply) => { rp.idx = ply; this.renderReplay(); },
    });
    $('r-plies').textContent = rp.idx + ' / ' + (rp.states.length - 1);
    $('r-first').disabled = $('r-prev').disabled = rp.idx === 0;
    $('r-next').disabled = $('r-last').disabled = rp.idx === rp.states.length - 1;
  },

  replayStep(delta) {
    const rp = this.replay;
    if (!rp) return;
    rp.idx = Math.max(0, Math.min(rp.states.length - 1, rp.idx + delta));
    this.renderReplay();
  },
};

// ---------------------------------------------------------------- wiring
$('auth-go').addEventListener('click', () => App.authSubmit());
$('btn-play').addEventListener('click', () => App.startMatchmaking());
$('mm-cancel').addEventListener('click', () => App.cancelMatchmaking());
$('btn-invite').addEventListener('click', () => App.inviteFriend());

$('btn-back').addEventListener('click', () => App.showMenu());
$('btn-resign').addEventListener('click', () => App.game && App.game.resign());
$('btn-draw').addEventListener('click', () => App.game && App.game.offerDraw());
$('draw-accept').addEventListener('click', () => App.game && App.game.sendCmd({ type: 'accept-draw' }));
$('draw-decline').addEventListener('click', () => App.game && App.game.sendCmd({ type: 'decline-draw' }));
$('go-menu').addEventListener('click', () => App.showMenu());
$('go-replay').addEventListener('click', () => {
  const id = App.game && App.game.sessionId;
  if (id) App.openReplay(id);
});
$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('chat-input');
  if (App.game && input.value.trim()) { App.game.sendChat(input.value); input.value = ''; }
});
$('btn-voice').addEventListener('click', () => {
  const v = App.game && App.game.voice;
  if (!v) return;
  if (v.enabled) v.disable(false); else v.enable();
});
$('btn-mute').addEventListener('click', () => App.game && App.game.voice.toggleMute());

$('r-back').addEventListener('click', () => App.showMenu());
$('r-first').addEventListener('click', () => App.replayStep(-Infinity));
$('r-prev').addEventListener('click', () => App.replayStep(-1));
$('r-next').addEventListener('click', () => App.replayStep(1));
$('r-last').addEventListener('click', () => App.replayStep(Infinity));

document.addEventListener('keydown', (e) => {
  if (App.currentView !== 'replay' || !$('modal').hidden) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); App.replayStep(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); App.replayStep(1); }
  else if (e.key === 'Home') { e.preventDefault(); App.replayStep(-Infinity); }
  else if (e.key === 'End') { e.preventDefault(); App.replayStep(Infinity); }
});

App.init();
